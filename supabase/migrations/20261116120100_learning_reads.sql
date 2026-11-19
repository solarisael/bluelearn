create table public.learning_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  guide_id uuid not null references public.guides(id) on delete cascade,
  revision_id uuid not null references public.guide_revisions(id) on delete cascade,
  marked_at timestamptz not null default now(),
  primary key(user_id, guide_id)
);
alter table public.learning_reads enable row level security;
create policy "Own read marks" on public.learning_reads for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.learning_reads from anon, authenticated;
grant select on public.learning_reads to authenticated;
grant all on public.learning_reads to service_role;

create function public.learning_read_state(p_guide_ids uuid[] default '{}', p_guide_id uuid default null, p_revision_id uuid default null, p_read boolean default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_base uuid; v_previous public.learning_reads; v_read jsonb; v_changed boolean := false; v_event jsonb := null;
begin
  if v_user is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if cardinality(p_guide_ids) > 100 then
    raise exception 'At most 100 guide identifiers are allowed' using errcode = '22023';
  end if;
  if p_read is null then
    return jsonb_build_object('reads', coalesce((
      select jsonb_agg(jsonb_build_object('guide_id', r.guide_id, 'revision_id', r.revision_id, 'marked_at', r.marked_at,
        'has_newer_revision', g.current_revision_id is distinct from r.revision_id) order by r.guide_id)
      from public.learning_reads r join public.guides g on g.id = r.guide_id
      where r.user_id = v_user and r.guide_id = any(p_guide_ids)
    ), '[]'::jsonb));
  end if;

  v_user := public.learning_lock_user();
  v_base := public.learning_validate_reader(p_guide_id, p_revision_id);
  select * into v_previous from public.learning_reads where user_id = v_user and guide_id = p_guide_id;
  if p_read and v_previous.guide_id is null then
    insert into public.learning_reads(user_id, guide_id, revision_id) values(v_user, p_guide_id, p_revision_id);
    v_changed := true;
  elsif p_read and v_previous.revision_id is distinct from p_revision_id then
    update public.learning_reads set revision_id = p_revision_id, marked_at = now() where user_id = v_user and guide_id = p_guide_id;
    v_changed := true;
  elsif not p_read and v_previous.guide_id is not null then
    delete from public.learning_reads where user_id = v_user and guide_id = p_guide_id;
    v_changed := true;
  end if;

  select jsonb_build_object('guide_id', guide_id, 'revision_id', revision_id, 'marked_at', marked_at, 'has_newer_revision', false)
    into v_read from public.learning_reads where user_id = v_user and guide_id = p_guide_id;
  if v_changed then
    v_event := jsonb_build_object('event_id', gen_random_uuid(), 'name', case when p_read then 'guide_marked_read' else 'guide_marked_unread' end,
      'guide_id', p_guide_id, 'revision_id', p_revision_id, 'guide_base_id', v_base);
  end if;

  return jsonb_build_object('read', v_read, 'changed', v_changed, '_event', v_event);
end;
$$;

revoke all on function public.learning_read_state(uuid[],uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.learning_read_state(uuid[],uuid,uuid,boolean) to authenticated;
