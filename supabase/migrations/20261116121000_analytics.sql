create table public.analytics_collection_state (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  collection_started_at timestamptz
);
insert into public.analytics_collection_state(singleton) values(true);
create table public.analytics_collection_windows (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  ended_at timestamptz,
  check(ended_at is null or ended_at >= started_at)
);
create unique index analytics_one_open_window_idx on public.analytics_collection_windows((true)) where ended_at is null;
-- Retry deduplication lasts 90 days; expired identifiers use a new receipt time.
create table public.analytics_event_receipts (
  event_id uuid primary key,
  received_at timestamptz not null default now()
);
create index analytics_event_receipts_retention_idx on public.analytics_event_receipts(received_at);
create table public.analytics_events (
  event_id uuid primary key references public.analytics_event_receipts(event_id),
  user_id uuid references public.profiles(id) on delete cascade,
  received_at timestamptz not null default now(),
  name text not null check(name in (
    'search_submitted','search_zero_results','search_result_selected','reader_opened','variant_selected',
    'reader_load_failed','progress_save_failed','content_unavailable','guide_marked_read','guide_marked_unread',
    'objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened'
  )),
  source text check(source in ('search','subject','objective','guide','direct','history','resume')),
  guide_id uuid,
  revision_id uuid,
  guide_base_id uuid,
  objective_id uuid,
  objective_revision_id uuid,
  entity_type text check(entity_type in ('guide','objective')),
  result_count integer check(result_count between 0 and 1000000),
  error_category text check(error_category in ('network','server','unavailable','conflict','forbidden')),
  was_anonymous boolean not null default true,
  rolled_up_at timestamptz
);
create index analytics_events_retention_idx on public.analytics_events(received_at);
create index analytics_events_unrolled_idx on public.analytics_events(received_at,event_id) where rolled_up_at is null;
create index analytics_events_accounts_idx on public.analytics_events(user_id,received_at) where user_id is not null;
create table public.analytics_daily (
  day date not null,
  dimension_key text not null,
  name text not null,
  source text,
  guide_base_id uuid,
  objective_id uuid,
  entity_type text,
  error_category text,
  event_count bigint not null,
  anonymous_count bigint not null,
  primary key(day, dimension_key)
);

alter table public.analytics_collection_state enable row level security;
alter table public.analytics_collection_windows enable row level security;
alter table public.analytics_event_receipts enable row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_daily enable row level security;
revoke all on public.analytics_collection_state, public.analytics_collection_windows, public.analytics_event_receipts, public.analytics_events, public.analytics_daily from anon, authenticated;
grant all on public.analytics_collection_state, public.analytics_collection_windows, public.analytics_event_receipts, public.analytics_events, public.analytics_daily to service_role;
revoke all on sequence public.analytics_collection_windows_id_seq from anon, authenticated;
grant usage, select on sequence public.analytics_collection_windows_id_seq to service_role;

create function public.analytics_set_collection(p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.analytics_collection_state set enabled = p_enabled,
    collection_started_at = case when p_enabled then coalesce(collection_started_at, now()) else collection_started_at end
    where singleton and enabled is distinct from p_enabled;

  if not found then
    return;
  end if;
  if p_enabled then
    insert into public.analytics_collection_windows(started_at) values(now());
  else
    update public.analytics_collection_windows set ended_at = now() where ended_at is null;
  end if;
end;
$$;

create function public.analytics_unlink_paused_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.history_paused then
    update public.analytics_events set user_id = null where user_id = new.user_id;
  end if;
  return new;
end;
$$;
create trigger learning_pause_unlinks_analytics after insert or update of history_paused on public.learning_preferences
  for each row when (new.history_paused) execute function public.analytics_unlink_paused_history();

create function public.analytics_ingest(p_events jsonb, p_user_id uuid default null, p_enabled boolean default false, p_server boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event jsonb; v_name text; v_guide uuid; v_revision uuid; v_base uuid; v_objective uuid; v_objective_revision uuid;
  v_actual_base uuid; v_current uuid; v_user uuid := p_user_id; v_paused boolean; v_count integer; v_accepted integer := 0; v_duplicates integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 20 then
    raise exception 'Expected between one and twenty events' using errcode = '22023';
  end if;

  perform public.analytics_set_collection(p_enabled);
  if p_enabled and p_user_id is not null then
    insert into public.learning_preferences(user_id) values(p_user_id) on conflict do nothing;
    select history_paused into v_paused from public.learning_preferences where user_id = p_user_id for update;
    if v_paused then
      v_user := null;
    end if;
  end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(v_event) <> 'object' or exists (
      select 1 from jsonb_object_keys(v_event) k where k not in ('event_id','name','source','guide_id','revision_id','guide_base_id','objective_id','objective_revision_id','entity_type','result_count','error_category')
    ) then
      raise exception 'Unexpected event field' using errcode = '22023';
    end if;

    v_name := v_event->>'name';
    if v_name is null or (not p_server and v_name not in ('search_submitted','search_zero_results','search_result_selected','reader_opened','variant_selected','reader_load_failed','progress_save_failed','content_unavailable'))
      or (p_server and v_name not in ('guide_marked_read','guide_marked_unread','objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened')) then
      raise exception 'Invalid event name' using errcode = '22023';
    end if;
    if v_event->>'event_id' is null or v_event->>'source' is not null and v_event->>'source' not in ('search','subject','objective','guide','direct','history','resume')
      or v_event->>'entity_type' is not null and v_event->>'entity_type' not in ('guide','objective')
      or v_event->>'error_category' is not null and v_event->>'error_category' not in ('network','server','unavailable','conflict','forbidden')
      or v_event->>'result_count' is not null and (v_event->>'result_count')::integer not between 0 and 1000000 then
      raise exception 'Invalid event metadata' using errcode = '22023';
    end if;

    v_guide := (v_event->>'guide_id')::uuid; v_revision := (v_event->>'revision_id')::uuid;
    v_base := (v_event->>'guide_base_id')::uuid; v_objective := (v_event->>'objective_id')::uuid;
    v_objective_revision := (v_event->>'objective_revision_id')::uuid;
    if v_revision is not null and v_guide is null or v_objective_revision is not null and v_objective is null then
      raise exception 'An identifier requires its parent identifier' using errcode = '22023';
    end if;

    if v_guide is not null then
      select g.guide_base_id, g.current_revision_id into v_actual_base, v_current
        from public.guides g join public.guide_bases b on b.id = g.guide_base_id
        join public.guide_revisions r on r.id = g.current_revision_id and r.guide_id = g.id
        where g.id = v_guide and g.status = 'published' and b.status = 'published'
          and r.approved_at is not null and not r.is_purged and r.status = 'submitted';
      if not found or v_base is not null and v_base <> v_actual_base then
        raise exception 'Invalid published guide reference' using errcode = '22023';
      end if;
      if v_revision is not null and v_revision <> v_current then
        raise exception 'The displayed guide revision is stale' using errcode = 'PT409';
      end if;
      v_base := v_actual_base;
    elsif v_base is not null and not exists (
      select 1 from public.guide_bases b join public.guides g on g.id = b.canonical_guide_id
      join public.guide_revisions r on r.id = g.current_revision_id
      where b.id = v_base and b.status = 'published' and g.status = 'published' and not r.is_purged and r.approved_at is not null
    ) then
      raise exception 'Invalid published topic reference' using errcode = '22023';
    end if;

    if v_objective is not null then
      if not exists(select 1 from public.objectives o join public.objective_revisions r on r.id = o.current_revision_id
        where o.id = v_objective and o.status = 'published' and r.status = 'published') then
        raise exception 'Invalid published objective reference' using errcode = '22023';
      end if;
      if v_objective_revision is not null and not exists(select 1 from public.objective_revisions where id = v_objective_revision and objective_id = v_objective and status = 'published') then
        raise exception 'Invalid objective revision reference' using errcode = '22023';
      end if;
      if v_base is not null and not exists (
        select 1 from public.objective_revision_nodes n join public.objectives o on o.id = v_objective
        where n.revision_id = coalesce(v_objective_revision, o.current_revision_id) and n.is_included
          and n.guide_base_id = v_base and (v_guide is null or n.guide_id = v_guide)
      ) then
        raise exception 'Guide does not belong to the objective revision' using errcode = '22023';
      end if;
    end if;

    if v_name in ('search_submitted','search_zero_results') and (v_guide is not null or v_base is not null or v_objective is not null)
      or v_name = 'search_zero_results' and coalesce((v_event->>'result_count')::integer, -1) <> 0
      or v_name = 'search_result_selected' and (
        v_event->>'entity_type' is null or v_event->>'entity_type' = 'guide' and (v_base is null or v_objective is not null)
        or v_event->>'entity_type' = 'objective' and (v_objective is null or v_base is not null)
      )
      or v_name = 'reader_opened' and (v_guide is null or v_revision is null)
      or v_name = 'variant_selected' and (v_guide is null or v_revision is not null)
      or v_name in ('reader_load_failed','progress_save_failed','content_unavailable') and v_event->>'error_category' is null
      or v_name = 'progress_save_failed' and (v_guide is not null or v_revision is not null or v_base is not null or v_objective is not null or v_objective_revision is not null)
      or v_name not in ('reader_load_failed','progress_save_failed','content_unavailable') and v_event->>'error_category' is not null then
      raise exception 'Inconsistent event identifiers or metadata' using errcode = '22023';
    end if;

    if not p_enabled then
      continue;
    end if;

    insert into public.analytics_event_receipts(event_id) values((v_event->>'event_id')::uuid) on conflict do nothing;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;

    insert into public.analytics_events(event_id,user_id,name,source,guide_id,revision_id,guide_base_id,objective_id,objective_revision_id,entity_type,result_count,error_category,was_anonymous)
      values((v_event->>'event_id')::uuid,v_user,v_name,v_event->>'source',v_guide,v_revision,v_base,v_objective,v_objective_revision,
        v_event->>'entity_type',(v_event->>'result_count')::integer,v_event->>'error_category',v_user is null);
    v_accepted := v_accepted + 1;
  end loop;
  return jsonb_build_object('accepted',v_accepted,'duplicates',v_duplicates,'enabled',p_enabled);
end;
$$;

create function public.analytics_cleanup(p_batch_size integer default 5000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rolled integer; v_events integer; v_event_receipts integer; v_visits integer; v_receipts integer; v_mutations integer; v_daily integer;
begin
  if p_batch_size not between 1 and 10000 then
    raise exception 'Invalid cleanup batch size' using errcode = '22023';
  end if;

  with batch as materialized (
    select * from public.analytics_events where rolled_up_at is null order by received_at,event_id limit p_batch_size for update skip locked
  ), grouped as (
    select (received_at at time zone 'UTC')::date as day,
      jsonb_build_array(name,source,guide_base_id,objective_id,entity_type,error_category)::text as dimension_key,
      name,source,guide_base_id,objective_id,entity_type,error_category,count(*) as event_count,count(*) filter(where was_anonymous) as anonymous_count
      from batch group by 1,2,3,4,5,6,7,8
  ), saved as (
    insert into public.analytics_daily(day,dimension_key,name,source,guide_base_id,objective_id,entity_type,error_category,event_count,anonymous_count)
      select * from grouped where day >= (now() at time zone 'UTC')::date - 364
      on conflict(day,dimension_key) do update set event_count = public.analytics_daily.event_count + excluded.event_count,
        anonymous_count = public.analytics_daily.anonymous_count + excluded.anonymous_count
      returning 1
  )
  update public.analytics_events set rolled_up_at = now() where event_id in (select event_id from batch);
  get diagnostics v_rolled = row_count;

  delete from public.analytics_events where event_id in (
    select event_id from public.analytics_events where received_at < now() - interval '90 days' and rolled_up_at is not null order by received_at limit p_batch_size
  );
  get diagnostics v_events = row_count;
  delete from public.analytics_event_receipts where event_id in (
    select r.event_id from public.analytics_event_receipts r
      where r.received_at < now() - interval '90 days'
        and not exists(select 1 from public.analytics_events e where e.event_id = r.event_id)
      order by r.received_at limit p_batch_size
  );
  get diagnostics v_event_receipts = row_count;
  delete from public.learning_visits where (user_id,guide_id) in (
    select user_id,guide_id from public.learning_visits where visited_at < now() - interval '90 days' order by visited_at limit p_batch_size
  );
  get diagnostics v_visits = row_count;
  delete from public.learning_visit_receipts where (user_id,event_id) in (
    select user_id,event_id from public.learning_visit_receipts where received_at < now() - interval '90 days' order by received_at limit p_batch_size
  );
  get diagnostics v_receipts = row_count;
  delete from public.learning_mutation_receipts where (user_id,event_id) in (
    select user_id,event_id from public.learning_mutation_receipts where received_at < now() - interval '90 days' order by received_at limit p_batch_size
  );
  get diagnostics v_mutations = row_count;
  delete from public.analytics_daily where (day,dimension_key) in (
    select day,dimension_key from public.analytics_daily where day < (now() at time zone 'UTC')::date - 364 order by day limit p_batch_size
  );
  get diagnostics v_daily = row_count;
  return jsonb_build_object('rolled_up',v_rolled,'events_deleted',v_events,'event_receipts_deleted',v_event_receipts,'visits_deleted',v_visits,'visit_receipts_deleted',v_receipts,'mutation_receipts_deleted',v_mutations,'aggregates_deleted',v_daily);
end;
$$;

create function public.analytics_observed(p_from date, p_to date) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_from >= (now() at time zone 'UTC')::date - 364
    and p_to <= (now() at time zone 'UTC')::date
    and exists(select 1 from public.analytics_collection_windows
      where started_at <= p_from::timestamp at time zone 'UTC'
        and coalesce(ended_at, now()) >= least((p_to + 1)::timestamp at time zone 'UTC', now()));
$$;
create function public.analytics_report_events(p_from date, p_to date)
returns table(day date,name text,source text,guide_base_id uuid,objective_id uuid,event_count bigint,anonymous_count bigint)
language sql stable security definer set search_path = '' as $$
  select a.day,a.name,a.source,a.guide_base_id,a.objective_id,a.event_count,a.anonymous_count from public.analytics_daily a where a.day between p_from and p_to
  union all
  select (e.received_at at time zone 'UTC')::date,e.name,e.source,e.guide_base_id,e.objective_id,count(*),count(*) filter(where e.was_anonymous)
    from public.analytics_events e where e.rolled_up_at is null and e.received_at >= p_from::timestamp at time zone 'UTC'
      and e.received_at < (p_to + 1)::timestamp at time zone 'UTC'
    group by 1,2,3,4,5;
$$;
create function public.analytics_metric(p_key text,p_label text,p_value numeric,p_unit text,p_definition text,p_reason text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('key',p_key,'label',p_label,'value',p_value,'unit',p_unit,'definition',p_definition,'reason',p_reason);
$$;

create function public.analytics_return_cohort(p_from date,p_to date,p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_eligible bigint; v_returned bigint;
begin
  with activity as materialized (
    select distinct user_id,(received_at at time zone 'UTC')::date as day from public.analytics_events
      where user_id is not null and received_at >= greatest(p_from, (now() at time zone 'UTC')::date - 89)::timestamp at time zone 'UTC'
        and name in ('reader_opened','guide_marked_read','guide_marked_unread','objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened')
  ), eligible_days as (
    select day from activity group by day having count(*) >= 5
  ), ordered_activity as (
    select user_id,day,lead(day) over(partition by user_id order by day) as next_day from activity
  ), cohorts as (
    select a.* from ordered_activity a join eligible_days d using(day)
      where a.day between p_from and p_to
        and a.day + p_days < (now() at time zone 'UTC')::date
        and public.analytics_observed(a.day, a.day + p_days)
        and a.day >= (now() at time zone 'UTC')::date - 89
  )
  select count(*),count(*) filter(where next_day between day + 1 and day + p_days)
    into v_eligible,v_returned from cohorts;

  if v_eligible = 0 then
    return jsonb_build_object('value',null,'reason','No complete matured cohort with at least five signed-in accounts is available.');
  end if;
  return jsonb_build_object('value',round(100.0 * v_returned / v_eligible,2),'reason',null);
end;
$$;

revoke all on function public.analytics_set_collection(boolean), public.analytics_unlink_paused_history(), public.analytics_ingest(jsonb,uuid,boolean,boolean), public.analytics_cleanup(integer), public.analytics_observed(date,date), public.analytics_report_events(date,date), public.analytics_metric(text,text,numeric,text,text,text), public.analytics_return_cohort(date,date,integer) from public, anon, authenticated;
grant execute on function public.analytics_set_collection(boolean), public.analytics_ingest(jsonb,uuid,boolean,boolean), public.analytics_cleanup(integer) to service_role;
