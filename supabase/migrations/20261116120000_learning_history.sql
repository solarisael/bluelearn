create table public.learning_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  history_paused boolean not null default false
);
create table public.learning_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  guide_id uuid not null references public.guides(id) on delete cascade,
  guide_base_id uuid not null references public.guide_bases(id) on delete cascade,
  revision_id uuid not null references public.guide_revisions(id) on delete cascade,
  source text not null check (source in ('search','subject','objective','guide','direct','history','resume')),
  objective_id uuid references public.objectives(id) on delete set null,
  objective_revision_id uuid references public.objective_revisions(id) on delete set null,
  target_guide_base_id uuid references public.guide_bases(id) on delete set null,
  visited_at timestamptz not null default now(),
  primary key(user_id, guide_id)
);
create index learning_visits_retention_idx on public.learning_visits(visited_at);
create index learning_visits_user_time_idx on public.learning_visits(user_id, visited_at desc);
create table public.learning_visit_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  received_at timestamptz not null default now(),
  primary key(user_id, event_id)
);
create index learning_visit_receipts_retention_idx on public.learning_visit_receipts(received_at);

alter table public.learning_preferences enable row level security;
alter table public.learning_visits enable row level security;
alter table public.learning_visit_receipts enable row level security;
create policy "Own learning preferences" on public.learning_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy "Own learning visits" on public.learning_visits for select to authenticated using (user_id = (select auth.uid()));
create policy "Own visit receipts" on public.learning_visit_receipts for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.learning_preferences, public.learning_visits, public.learning_visit_receipts from anon, authenticated;
grant select on public.learning_preferences, public.learning_visits, public.learning_visit_receipts to authenticated;
grant all on public.learning_preferences, public.learning_visits, public.learning_visit_receipts to service_role;

-- Serialize private mutations with pause changes and completion checks for this account.
create function public.learning_lock_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  insert into public.learning_preferences(user_id) values(v_user) on conflict do nothing;
  perform 1 from public.learning_preferences where user_id = v_user for update;
  return v_user;
end;
$$;
revoke all on function public.learning_lock_user() from public, anon, authenticated;

create function public.learning_preferences_state(p_patch jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_patch is not null then
    v_user := public.learning_lock_user();
    if jsonb_typeof(p_patch) <> 'object' or exists (
      select 1 from jsonb_each(p_patch) e where e.key <> 'history_paused' or jsonb_typeof(e.value) <> 'boolean'
    ) then
      raise exception 'Invalid preferences' using errcode = '22023';
    end if;

    update public.learning_preferences set
      history_paused = coalesce((p_patch->>'history_paused')::boolean, history_paused)
    where user_id = v_user;
  end if;

  select jsonb_build_object('history_paused', history_paused)
    into v_result from public.learning_preferences where user_id = v_user;
  return coalesce(v_result, '{"history_paused":false}'::jsonb);
end;
$$;

create function public.learning_validate_reader(p_guide uuid, p_revision uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_base uuid; v_current uuid;
begin
  select g.guide_base_id, g.current_revision_id into v_base, v_current
    from public.guides g join public.guide_bases b on b.id = g.guide_base_id
    join public.guide_revisions r on r.id = g.current_revision_id and r.guide_id = g.id
    where g.id = p_guide and g.status = 'published' and b.status = 'published'
      and r.status = 'submitted' and r.approved_at is not null and not r.is_purged
    for share of g, b, r;

  if not found then
    raise exception 'Published guide not found' using errcode = 'P0002';
  end if;
  if v_current is distinct from p_revision then
    raise exception 'The displayed guide revision is stale; refresh before saving' using errcode = 'PT409';
  end if;

  return v_base;
end;
$$;
revoke all on function public.learning_validate_reader(uuid, uuid) from public, anon, authenticated;

create function public.learning_history_state(p_action text, p_input jsonb default '{}'::jsonb, p_page integer default 1, p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_base uuid; v_guide uuid; v_revision uuid; v_objective uuid;
  v_objective_revision uuid; v_target uuid; v_paused boolean; v_inserted integer; v_visits jsonb; v_total bigint;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_page < 1 or p_limit not between 1 and 100 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;

  if p_action = 'list' then
    select coalesce(history_paused, false) into v_paused from public.learning_preferences where user_id = v_user;
    select count(*) into v_total from public.learning_visits where user_id = v_user and visited_at >= now() - interval '90 days';
    select coalesce(jsonb_agg(row_data order by visited_at desc, guide_id), '[]'::jsonb) into v_visits from (
      select h.visited_at, h.guide_id, jsonb_build_object(
        'guide_id', h.guide_id, 'guide_base_id', h.guide_base_id, 'revision_id', h.revision_id,
        'source', h.source, 'visited_at', h.visited_at,
        'title', case when live.available then r.title end,
        'slug', case when live.available then b.slug end,
        'variant_slug', case when live.available then g.slug end,
        'available', live.available
      ) as row_data
      from public.learning_visits h join public.guides g on g.id = h.guide_id
      join public.guide_bases b on b.id = h.guide_base_id join public.guide_revisions r on r.id = h.revision_id
      cross join lateral(select g.status = 'published' and b.status = 'published' and not r.is_purged and exists(
        select 1 from public.guide_revisions current where current.id = g.current_revision_id and current.guide_id = g.id
          and current.status = 'submitted' and current.approved_at is not null and not current.is_purged
      ) as available) live
      where h.user_id = v_user and h.visited_at >= now() - interval '90 days'
      order by h.visited_at desc, h.guide_id limit p_limit offset (p_page - 1)::bigint * p_limit
    ) page;
    return jsonb_build_object('visits', v_visits, 'total', v_total, 'retention_days', 90, 'paused', coalesce(v_paused, false));
  end if;

  v_user := public.learning_lock_user();
  if p_action = 'clear' then
    delete from public.learning_visits where user_id = v_user;
    return '{"ok":true}'::jsonb;
  end if;
  if p_action = 'remove' then
    delete from public.learning_visits where user_id = v_user and guide_id = (p_input->>'guide_id')::uuid;
    return '{"ok":true}'::jsonb;
  end if;
  if p_action <> 'record' then
    raise exception 'Invalid history action' using errcode = '22023';
  end if;

  v_guide := (p_input->>'guide_id')::uuid;
  v_revision := (p_input->>'revision_id')::uuid;
  v_base := public.learning_validate_reader(v_guide, v_revision);
  v_objective := (p_input->>'objective_id')::uuid;
  v_objective_revision := (p_input->>'objective_revision_id')::uuid;
  v_target := (p_input->>'target_guide_base_id')::uuid;

  if (v_objective is null) <> (v_objective_revision is null)
    or (v_target is not null and v_objective is null) then
    raise exception 'Invalid objective context' using errcode = '22023';
  end if;
  if v_objective is not null and not exists (
    select 1 from public.objectives o join public.objective_revisions r on r.objective_id = o.id
    join public.objective_revision_nodes n on n.revision_id = r.id
    where o.id = v_objective and o.status = 'published' and r.id = v_objective_revision and r.status = 'published'
      and n.guide_id = v_guide and n.guide_base_id = v_base and n.is_included
  ) then
    raise exception 'Guide does not belong to this published objective revision' using errcode = '22023';
  end if;
  if v_target is not null and not exists (
    select 1 from public.objective_revision_nodes where revision_id = v_objective_revision and guide_base_id = v_target and is_target and is_included
  ) then
    raise exception 'Invalid objective target' using errcode = '22023';
  end if;

  select history_paused into v_paused from public.learning_preferences where user_id = v_user;
  if v_paused then
    return '{"recorded":false}'::jsonb;
  end if;

  insert into public.learning_visit_receipts(user_id, event_id) values(v_user, (p_input->>'event_id')::uuid) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return '{"recorded":false}'::jsonb;
  end if;

  insert into public.learning_visits(user_id, guide_id, guide_base_id, revision_id, source, objective_id, objective_revision_id, target_guide_base_id)
    values(v_user, v_guide, v_base, v_revision, p_input->>'source', v_objective, v_objective_revision, v_target)
    on conflict(user_id, guide_id) do update set revision_id = excluded.revision_id, source = excluded.source,
      objective_id = excluded.objective_id, objective_revision_id = excluded.objective_revision_id,
      target_guide_base_id = excluded.target_guide_base_id, visited_at = now();
  return '{"recorded":true}'::jsonb;
end;
$$;

revoke all on function public.learning_preferences_state(jsonb), public.learning_history_state(text,jsonb,integer,integer) from public, anon, authenticated;
grant execute on function public.learning_preferences_state(jsonb), public.learning_history_state(text,jsonb,integer,integer) to authenticated;
