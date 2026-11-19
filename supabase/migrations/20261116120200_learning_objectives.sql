alter table public.learning_preferences add column show_completed_objectives boolean not null default false;

create or replace function public.learning_preferences_state(p_patch jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_result jsonb;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_patch is not null then
    v_user := public.learning_lock_user();
    if jsonb_typeof(p_patch) <> 'object' or exists (
      select 1 from jsonb_each(p_patch) e where e.key not in ('history_paused','show_completed_objectives') or jsonb_typeof(e.value) <> 'boolean'
    ) then
      raise exception 'Invalid preferences' using errcode = '22023';
    end if;

    update public.learning_preferences set
      history_paused = coalesce((p_patch->>'history_paused')::boolean, history_paused),
      show_completed_objectives = coalesce((p_patch->>'show_completed_objectives')::boolean, show_completed_objectives)
    where user_id = v_user;
  end if;

  select jsonb_build_object('history_paused', history_paused, 'show_completed_objectives', show_completed_objectives)
    into v_result from public.learning_preferences where user_id = v_user;
  return coalesce(v_result, '{"history_paused":false,"show_completed_objectives":false}'::jsonb);
end;
$$;

create table public.learning_enrollments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  objective_revision_id uuid not null references public.objective_revisions(id) on delete restrict,
  target_guide_base_id uuid references public.guide_bases(id) on delete set null,
  position_guide_base_id uuid references public.guide_bases(id) on delete set null,
  started_at timestamptz not null default now(),
  last_resumed_at timestamptz,
  completed_at timestamptz,
  completed_revision_id uuid references public.objective_revisions(id) on delete set null,
  last_completed_at timestamptz,
  primary key(user_id, objective_id)
);

create table public.learning_mutation_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null,
  objective_id uuid not null references public.objectives(id) on delete cascade,
  action text not null check(action in ('start','resume','complete','reopen')),
  input jsonb not null,
  received_at timestamptz not null default now(),
  primary key(user_id, event_id)
);
create index learning_mutation_receipts_retention_idx on public.learning_mutation_receipts(received_at);
alter table public.learning_mutation_receipts enable row level security;
revoke all on public.learning_mutation_receipts from anon, authenticated;
grant all on public.learning_mutation_receipts to service_role;

alter table public.learning_enrollments enable row level security;
create policy "Own objective enrollments" on public.learning_enrollments for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.learning_enrollments from anon, authenticated;
grant select on public.learning_enrollments to authenticated;
grant all on public.learning_enrollments to service_role;

create function public.learning_objective_view(p_user uuid, p_objective uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_objective public.objectives; v_enrollment public.learning_enrollments; v_revision uuid; v_steps jsonb; v_counts jsonb; v_title text;
begin
  select * into v_objective from public.objectives where id = p_objective and status = 'published' and current_revision_id is not null;
  if not found then
    raise exception 'Published objective not found' using errcode = 'P0002';
  end if;

  select * into v_enrollment from public.learning_enrollments where user_id = p_user and objective_id = p_objective;
  v_revision := coalesce(v_enrollment.objective_revision_id, v_objective.current_revision_id);
  select title into v_title from public.objective_revisions where id = v_revision and objective_id = p_objective and status = 'published';
  if not found then
    raise exception 'Published objective revision not found' using errcode = 'P0002';
  end if;

  with steps as (
    select n.id, n.target_position, n.guide_base_id, n.guide_id, n.is_target,
      case when n.guide_base_id is null then 'requested'
        when g.status is distinct from 'published' or b.status is distinct from 'published' or r.id is null
          or r.is_purged or r.approved_at is null or r.status <> 'submitted' then 'unavailable'
        when m.guide_id is not null then 'read' else 'unread' end as state,
      g.slug as variant_slug, b.slug, case when n.guide_base_id is null then n.title else r.title end as title,
      g.current_revision_id as revision_id, m.revision_id is not null and m.revision_id is distinct from g.current_revision_id as has_newer_revision
    from public.objective_revision_nodes n
    left join public.guides g on g.id = n.guide_id and g.guide_base_id = n.guide_base_id
    left join public.guide_bases b on b.id = n.guide_base_id
    left join public.guide_revisions r on r.id = g.current_revision_id and r.guide_id = g.id
    left join public.learning_reads m on m.guide_id = n.guide_id and m.user_id = p_user
    where n.revision_id = v_revision and n.is_included
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'guide_base_id', guide_base_id, 'guide_id', guide_id, 'is_target', is_target,
    'variant_slug', case when state <> 'unavailable' then variant_slug end,
    'slug', case when state <> 'unavailable' then slug end,
    'title', case when state <> 'unavailable' then title end,
    'revision_id', case when state <> 'unavailable' then revision_id end,
    'state', state, 'has_newer_revision', has_newer_revision
  ) order by target_position nulls last, id), '[]'::jsonb),
  jsonb_build_object('included', count(*), 'read', count(*) filter(where state = 'read'),
    'requested', count(*) filter(where state = 'requested'), 'unavailable', count(*) filter(where state = 'unavailable'))
  into v_steps, v_counts from steps;

  return jsonb_build_object('objective_id', p_objective, 'slug', v_objective.slug, 'title', v_title,
    'enrollment', case when v_enrollment.user_id is not null then to_jsonb(v_enrollment) - 'user_id' - 'objective_id' else null end,
    'current_revision_id', v_objective.current_revision_id, 'steps', v_steps, 'counts', v_counts);
end;
$$;
revoke all on function public.learning_objective_view(uuid, uuid) from public, anon, authenticated;

create function public.learning_objective_state(p_slug text, p_action text default 'get', p_input jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_objective public.objectives; v_enrollment public.learning_enrollments;
  v_expected uuid := (p_input->>'expected_revision_id')::uuid; v_target uuid := (p_input->>'target_guide_base_id')::uuid;
  v_position uuid := (p_input->>'guide_base_id')::uuid; v_revision uuid; v_changed boolean := false; v_name text; v_result jsonb;
  v_receipt public.learning_mutation_receipts; v_event_id uuid := (p_input->>'event_id')::uuid;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_action not in ('get','start','resume','complete','reopen','position') then
    raise exception 'Invalid objective action' using errcode = '22023';
  end if;
  if p_action <> 'get' and (jsonb_typeof(p_input) <> 'object' or exists (
    select 1 from jsonb_each(p_input) field
      where field.key not in ('event_id','expected_revision_id','target_guide_base_id','guide_base_id')
        or p_action = 'position' and field.key = 'event_id'
        or p_action <> 'position' and field.key = 'guide_base_id'
        or jsonb_typeof(field.value) <> 'string'
  )) then
    raise exception 'Invalid objective action fields' using errcode = '22023';
  end if;
  if p_action <> 'get' then
    v_user := public.learning_lock_user();
  end if;

  select * into v_objective from public.objectives where slug = lower(p_slug) and status = 'published' and current_revision_id is not null for share;
  if not found then
    raise exception 'Published objective not found' using errcode = 'P0002';
  end if;
  if p_action = 'get' then
    return public.learning_objective_view(v_user, v_objective.id);
  end if;
  if p_action <> 'position' then
    if v_event_id is null then
      raise exception 'An event identifier is required' using errcode = '22023';
    end if;

    select * into v_receipt from public.learning_mutation_receipts where user_id = v_user and event_id = v_event_id;
    if found then
      if v_receipt.objective_id <> v_objective.id or v_receipt.action <> p_action or v_receipt.input <> p_input then
        raise exception 'Event identifier already belongs to another action' using errcode = 'PT409';
      end if;
      return public.learning_objective_view(v_user, v_objective.id);
    end if;
  end if;

  select * into v_enrollment from public.learning_enrollments where user_id = v_user and objective_id = v_objective.id;
  v_revision := case when p_action = 'reopen' then v_objective.current_revision_id else coalesce(v_enrollment.objective_revision_id, v_objective.current_revision_id) end;
  if v_expected is distinct from v_revision then
    raise exception 'The objective revision changed; refresh before saving' using errcode = 'PT409';
  end if;
  if v_target is not null and not exists (
    select 1 from public.objective_revision_nodes where revision_id = v_revision and guide_base_id = v_target and is_target and is_included
  ) then
    raise exception 'Invalid objective target' using errcode = '22023';
  end if;
  if p_action <> 'start' and v_enrollment.user_id is null then
    raise exception 'Start the objective before saving progress' using errcode = 'PT409';
  end if;

  if p_action = 'start' and v_enrollment.user_id is null then
    insert into public.learning_enrollments(user_id, objective_id, objective_revision_id, target_guide_base_id)
      values(v_user, v_objective.id, v_revision, v_target);
    v_changed := true; v_name := 'objective_started';
  elsif p_action = 'resume' then
    update public.learning_enrollments set last_resumed_at = now(), target_guide_base_id = coalesce(v_target, target_guide_base_id)
      where user_id = v_user and objective_id = v_objective.id;
    v_changed := true; v_name := 'objective_resumed';
  elsif p_action = 'position' then
    if v_position is null or not exists (
      select 1 from public.objective_revision_nodes where revision_id = v_revision and guide_base_id = v_position and is_included
    ) then
      raise exception 'Invalid objective position' using errcode = '22023';
    end if;
    if v_enrollment.position_guide_base_id is distinct from v_position or v_enrollment.target_guide_base_id is distinct from coalesce(v_target, v_enrollment.target_guide_base_id) then
      update public.learning_enrollments set position_guide_base_id = v_position, target_guide_base_id = coalesce(v_target, target_guide_base_id)
        where user_id = v_user and objective_id = v_objective.id;
      v_changed := true; v_name := 'objective_step_moved';
    end if;
  elsif p_action = 'complete' and v_enrollment.completed_at is null then
    perform 1 from public.guides g join public.guide_bases b on b.id = g.guide_base_id
      join public.guide_revisions r on r.id = g.current_revision_id
      join public.objective_revision_nodes n on n.guide_id = g.id
      where n.revision_id = v_revision and n.is_included for share of g, b, r;
    v_result := public.learning_objective_view(v_user, v_objective.id);
    if (v_result->'counts'->>'included')::integer = 0 or (v_result->'counts'->>'read')::integer <> (v_result->'counts'->>'included')::integer then
      raise exception 'Every included pinned guide must be available and read; requested steps prevent completion' using errcode = 'PT409';
    end if;

    update public.learning_enrollments set completed_at = now(), completed_revision_id = v_revision, last_completed_at = now()
      where user_id = v_user and objective_id = v_objective.id;
    v_changed := true; v_name := 'objective_completed';
  elsif p_action = 'reopen' then
    if v_enrollment.completed_at is not null or v_enrollment.objective_revision_id is distinct from v_revision then
      update public.learning_enrollments set objective_revision_id = v_revision, completed_at = null, last_resumed_at = null,
        target_guide_base_id = coalesce(v_target, (select guide_base_id from public.objective_revision_nodes where revision_id = v_revision and is_target and is_included and guide_base_id = v_enrollment.target_guide_base_id)),
        position_guide_base_id = (select guide_base_id from public.objective_revision_nodes where revision_id = v_revision and is_included and guide_base_id = v_enrollment.position_guide_base_id)
        where user_id = v_user and objective_id = v_objective.id;
      v_changed := true; v_name := 'objective_reopened';
    end if;
  end if;
  if p_action <> 'position' then
    insert into public.learning_mutation_receipts(user_id, event_id, objective_id, action, input)
      values(v_user, v_event_id, v_objective.id, p_action, p_input);
  end if;

  v_result := public.learning_objective_view(v_user, v_objective.id);
  if v_changed then
    v_result := v_result || jsonb_build_object('_event', jsonb_build_object('event_id', gen_random_uuid(), 'name', v_name,
      'objective_id', v_objective.id, 'objective_revision_id', v_revision));
  end if;
  return v_result;
end;
$$;

create function public.learning_objectives_state(p_page integer default 1, p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_rows jsonb; v_total bigint;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if p_page < 1 or p_limit not between 1 and 100 then
    raise exception 'Invalid pagination' using errcode = '22023';
  end if;

  select count(*) into v_total from public.learning_enrollments e join public.objectives o on o.id = e.objective_id
    where e.user_id = v_user and o.status = 'published';
  select coalesce(jsonb_agg(state order by started_at desc, objective_id), '[]'::jsonb) into v_rows from (
    select e.started_at, e.objective_id, public.learning_objective_view(v_user, e.objective_id) - 'steps' as state
      from public.learning_enrollments e join public.objectives o on o.id = e.objective_id
      where e.user_id = v_user and o.status = 'published'
      order by e.started_at desc, e.objective_id limit p_limit offset (p_page - 1)::bigint * p_limit
  ) page;
  return jsonb_build_object('objectives', v_rows, 'total', v_total);
end;
$$;

create function public.learning_public_completions(p_username text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('objectives', coalesce(jsonb_agg(jsonb_build_object(
    'slug', o.slug, 'title', r.title, 'completed_revision_id', e.completed_revision_id, 'completed_at', e.last_completed_at
  ) order by e.last_completed_at desc, o.id), '[]'::jsonb))
  from public.learning_enrollments e join public.profiles p on p.id = e.user_id
  join public.learning_preferences pref on pref.user_id = p.id and pref.show_completed_objectives
  join public.objectives o on o.id = e.objective_id and o.status = 'published'
  join public.objective_revisions r on r.id = e.completed_revision_id and r.objective_id = o.id and r.status = 'published'
  where lower(p.username) = lower(p_username) and e.last_completed_at is not null;
$$;

revoke all on function public.learning_objective_state(text,text,jsonb), public.learning_objectives_state(integer,integer), public.learning_public_completions(text) from public, anon, authenticated;
grant execute on function public.learning_objective_state(text,text,jsonb), public.learning_objectives_state(integer,integer) to authenticated;
grant execute on function public.learning_public_completions(text) to anon, authenticated;
