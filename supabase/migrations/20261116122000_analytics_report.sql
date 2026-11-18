create function public.analytics_available(p_from date, p_to date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.analytics_collection_windows
    where started_at < least((p_to + 1)::timestamp at time zone 'UTC', now())
      and coalesce(ended_at, now()) > greatest(
        p_from::timestamp at time zone 'UTC',
        ((now() at time zone 'UTC')::date - 364)::timestamp at time zone 'UTC')
      and greatest(p_from, (now() at time zone 'UTC')::date - 364) <= least(p_to, (now() at time zone 'UTC')::date)
  );
$$;
revoke all on function public.analytics_available(date,date) from public, anon, authenticated;

create function public.analytics_report(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_enabled boolean; v_started timestamptz; v_observed boolean; v_available boolean; v_raw boolean; v_reason text; v_status text;
  v_from date; v_to date;
  v_sections jsonb; v_daily jsonb; v_guides jsonb; v_objectives jsonb; v_discovery jsonb; v_reading jsonb; v_learning jsonb; v_editorial jsonb; v_reliability jsonb;
  v_counts jsonb; v_accounts bigint; v_learners bigint; v_return7 jsonb; v_return30 jsonb; v_turnaround numeric; v_queue numeric;
begin
  if not public.has_role('admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 365 then
    raise exception 'Use an ordered UTC range of at most 365 days' using errcode = '22023';
  end if;

  select enabled,collection_started_at into v_enabled,v_started from public.analytics_collection_state where singleton;
  v_observed := public.analytics_observed(p_from,p_to);
  v_available := public.analytics_available(p_from,p_to);
  v_from := greatest(p_from, (now() at time zone 'UTC')::date - 364);
  v_to := least(p_to, (now() at time zone 'UTC')::date);
  v_raw := v_observed and p_from >= (now() at time zone 'UTC')::date - 89;
  v_status := case when not v_available then 'unavailable'
    when not v_observed or p_to >= (now() at time zone 'UTC')::date then 'partial'
    else 'complete' end;
  v_reason := case
    when not v_available then 'No retained collection covers this range.'
    when p_from < v_from then 'Some selected dates exceed aggregate retention.'
    when not v_observed then 'Collection does not cover all selected times.'
    when p_to >= (now() at time zone 'UTC')::date then 'The selected range includes time that has not elapsed.'
  end;
  select coalesce(jsonb_object_agg(name,total),'{}'::jsonb) into v_counts from (
    select name,sum(event_count) as total from public.analytics_report_events(v_from,v_to) group by name
  ) counts;

  select count(distinct user_id) filter(where name = 'reader_opened'),
    count(distinct user_id) filter(where name in ('objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened'))
    into v_accounts,v_learners from public.analytics_events
    where received_at >= p_from::timestamp at time zone 'UTC' and received_at < (p_to + 1)::timestamp at time zone 'UTC';

  select jsonb_agg(public.analytics_metric(key,label,
    case when v_available then coalesce((v_counts->>key)::numeric,0) end,'events',definition,v_reason) order by position)
    into v_discovery from (values
      (1,'search_submitted','Submitted searches','Explicit search submissions received in the UTC range. Page loads and pagination do not count.'),
      (2,'search_zero_results','Zero-result searches','Explicit search submissions with zero results received in the UTC range.'),
      (3,'search_result_selected','Selected results','Explicit guide or objective search result selections received in the UTC range.')
    ) metrics(position,key,label,definition);

  select jsonb_agg(public.analytics_metric(key,label,
    case when v_available then coalesce((v_counts->>key)::numeric,0) end,'events',definition,v_reason) order by position)
    into v_reading from (values
      (1,'reader_opened','Reader opens','Successful visible reader opens. Repeated opens count; inspection revisions and previews do not.'),
      (2,'variant_selected','Variant selections','Explicit pinned or alternate variant selections received in the UTC range.'),
      (3,'guide_marked_read','Read marks','Successful durable read-state transitions, including explicit refresh of a read mark to a newer revision.'),
      (4,'guide_marked_unread','Unread actions','Successful durable removal of a read mark. Repeated desired-state requests do not count.')
    ) metrics(position,key,label,definition);
  v_reading := v_reading || jsonb_build_array(
    public.analytics_metric('signed_in_readers','Signed-in readers',case when v_raw and v_accounts >= 5 then v_accounts end,'accounts',
      'Distinct linked accounts with reader opens across the whole range. Daily distinct counts are not summed.',
      case when not v_raw then 'Complete account observation is limited to the retained raw-event window.' when v_accounts < 5 then 'Groups smaller than five accounts are suppressed.' end),
    public.analytics_metric('anonymous_reader_opens','Anonymous reader opens',case when v_available then
      coalesce((select sum(anonymous_count) from public.analytics_report_events(v_from,v_to) where name = 'reader_opened'),0) end,'events',
      'Reader opens received without account identity, including paused-history opens. This is not a count of anonymous visitors.',v_reason)
  );
  v_reading := v_reading || coalesce((select jsonb_agg(public.analytics_metric('reader_source_' || sources.source,'Reader opens: ' || sources.source,
    case when v_available then coalesce(counts.total,0) end,
    'events','Reader-open events attributed to this source category. Missing source metadata is not inferred.',v_reason) order by sources.source)
    from unnest(array['search','subject','objective','guide','direct','history','resume']) sources(source)
    left join (select source,sum(event_count) as total from public.analytics_report_events(v_from,v_to) where name = 'reader_opened' group by source) counts
      on counts.source = sources.source), '[]'::jsonb);

  select jsonb_agg(public.analytics_metric(key,label,
    case when v_available then coalesce((v_counts->>key)::numeric,0) end,'events',definition,v_reason) order by position)
    into v_learning from (values
      (1,'objective_started','Objective starts','Successful first enrollments on a published objective revision.'),
      (2,'objective_resumed','Objective resumes','Successful explicit resume actions. Retries with the same action identifier count once.'),
      (3,'objective_step_moved','Saved step changes','Successful changes to an enrolled objective position or selected target.'),
      (4,'objective_completed','Objective completions','Explicit completion transitions after every included pinned step is available and read.'),
      (5,'objective_reopened','Objective reopenings','Explicit adoption of the current published revision with completion cleared. Prior achievement fields remain.')
    ) metrics(position,key,label,definition);
  v_return7 := public.analytics_return_cohort(p_from,p_to,7);
  v_return30 := public.analytics_return_cohort(p_from,p_to,30);
  v_learning := v_learning || jsonb_build_array(
    public.analytics_metric('signed_in_learners','Signed-in objective learners',case when v_raw and v_learners >= 5 then v_learners end,'accounts',
      'Distinct linked accounts with objective state transitions across the range. Reader opens alone do not count.',
      case when not v_raw then 'Complete account observation is limited to the retained raw-event window.' when v_learners < 5 then 'Groups smaller than five accounts are suppressed.' end),
    public.analytics_metric('return_7_days','Seven-day learning return rate',(v_return7->>'value')::numeric,'percent',
      'Denominator: account-day learning cohorts in this range with five accounts and a complete matured window. Numerator: members active on days 1 through 7. Accounts can belong to repeated daily cohorts.',v_return7->>'reason'),
    public.analytics_metric('return_30_days','Thirty-day learning return rate',(v_return30->>'value')::numeric,'percent',
      'Denominator: account-day learning cohorts in this range with five accounts and a complete matured window. Numerator: members active on days 1 through 30. Accounts can belong to repeated daily cohorts.',v_return30->>'reason')
  );

  select avg(extract(epoch from (final_closed - created_at)) / 86400.0) into v_turnaround from (
    select c.id,c.created_at,max(p.closed_at) as final_closed from public.review_cases c
      join public.review_panels p on p.case_id = c.id
      where c.status in ('approved','rejected') group by c.id,c.created_at
      having max(p.closed_at) >= p_from::timestamp at time zone 'UTC'
        and max(p.closed_at) < (p_to + 1)::timestamp at time zone 'UTC'
  ) terminal_cases;
  select max(extract(epoch from (now() - created_at)) / 86400.0) into v_queue from public.review_cases where status in ('pending','in_review');
  v_editorial := jsonb_build_array(
    public.analytics_metric('submissions','Review submissions',(select count(*) from public.review_cases
      where created_at >= p_from::timestamp at time zone 'UTC' and created_at < (p_to + 1)::timestamp at time zone 'UTC'),
      'events','Review cases created in the UTC range, from existing case records.'),
    public.analytics_metric('decisions','Closed review panels',(select count(*) from public.review_panels
      where closed_at >= p_from::timestamp at time zone 'UTC' and closed_at < (p_to + 1)::timestamp at time zone 'UTC'),
      'panels','Panels closed in the UTC range. Individual votes are not editorial decisions.'),
    public.analytics_metric('guide_publications','Approved guide revisions',(select count(*) from public.guide_revisions
      where approved_at >= p_from::timestamp at time zone 'UTC' and approved_at < (p_to + 1)::timestamp at time zone 'UTC'),
      'events','Guide revision approvals recorded in the UTC range. A later canonical promotion is not a new publication.'),
    public.analytics_metric('objective_publications','Published objective revisions',(select count(*) from public.objective_revisions
      where published_at >= p_from::timestamp at time zone 'UTC' and published_at < (p_to + 1)::timestamp at time zone 'UTC'),
      'events','Objective revisions with a recorded publication date in the UTC range.'),
    public.analytics_metric('review_turnaround_days','Mean review turnaround',round(v_turnaround,2),'days',
      'Case creation to final closed panel for currently terminal cases whose final closure is in the range.',
      case when v_turnaround is null then 'No terminal cases have a final panel closure in this range.' end),
    public.analytics_metric('oldest_open_case_days','Oldest open case: current snapshot',round(v_queue,2),'days',
      'Current age of the oldest pending or in-review case. This is not a historical range metric.',
      case when v_queue is null then 'There are no open review cases.' end),
    public.analytics_metric('overdue_assignments','Overdue assignments: current snapshot',(select count(*) from public.panel_members m
      join public.review_panels p on p.id = m.panel_id where m.status = 'assigned' and m.expires_at < now() and p.closed_at is null),
      'assignments','Currently assigned seats past their expiry on open panels. This is not a historical range total.'),
    public.analytics_metric('fulfilled_requests','Fulfilled requests: current snapshot',(select count(*) from public.requests where status = 'resolved'),
      'requests','Currently resolved requests. Existing records do not support a complete historical fulfillment trend.')
  );

  select jsonb_agg(public.analytics_metric(key,label,
    case when v_available then coalesce((v_counts->>key)::numeric,0) end,'events',definition,v_reason) order by position)
    into v_reliability from (values
      (1,'reader_load_failed','Reader load failures','Untrusted client reports of reader load failures, with bounded error categories.'),
      (2,'progress_save_failed','Progress save failures','Untrusted client reports of failed explicit progress saves, separate from successful transitions.'),
      (3,'content_unavailable','Unavailable content','Untrusted client reports of unavailable content. No exception text or URLs are retained.')
    ) metrics(position,key,label,definition);

  select coalesce(jsonb_agg(jsonb_build_object('day',day,'observation',observation,
    'reader_opens',case when observed then opens end,'read_marks',case when observed then marks end,
    'objective_starts',case when observed then starts end,'objective_completions',case when observed then completions end,
    'reader_failures',case when observed then failures end) order by day),'[]'::jsonb) into v_daily from (
    select d.day::date as day,public.analytics_available(d.day::date,d.day::date) as observed,
      case when not public.analytics_available(d.day::date,d.day::date) then 'unavailable'
        when not public.analytics_observed(d.day::date,d.day::date) or d.day::date = (now() at time zone 'UTC')::date then 'partial'
        else 'complete' end as observation,
      coalesce(sum(e.event_count) filter(where e.name = 'reader_opened'),0) as opens,
      coalesce(sum(e.event_count) filter(where e.name = 'guide_marked_read'),0) as marks,
      coalesce(sum(e.event_count) filter(where e.name = 'objective_started'),0) as starts,
      coalesce(sum(e.event_count) filter(where e.name = 'objective_completed'),0) as completions,
      coalesce(sum(e.event_count) filter(where e.name = 'reader_load_failed'),0) as failures
      from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d(day)
      left join public.analytics_report_events(v_from,v_to) e on e.day = d.day::date group by d.day
  ) days;

  select coalesce(jsonb_agg(jsonb_build_object('guide_base_id',rows.guide_base_id,'title',r.title,'opens',rows.opens,'read_marks',rows.marks,
    'signed_in_readers',case when v_raw and accounts.total >= 5 then accounts.total end) order by rows.opens desc, rows.guide_base_id),'[]'::jsonb)
    into v_guides from (
      select guide_base_id,coalesce(sum(event_count) filter(where name = 'reader_opened'),0) as opens,
        coalesce(sum(event_count) filter(where name = 'guide_marked_read'),0) as marks
      from public.analytics_report_events(v_from,v_to) where guide_base_id is not null and v_available
        and name in ('reader_opened','guide_marked_read') group by guide_base_id order by opens desc,guide_base_id limit 50
    ) rows left join public.guide_bases b on b.id = rows.guide_base_id and b.status = 'published'
      left join public.guides g on g.id = b.canonical_guide_id and g.status = 'published'
      left join public.guide_revisions r on r.id = g.current_revision_id and not r.is_purged
      left join lateral(select count(distinct e.user_id) as total from public.analytics_events e
        where e.guide_base_id = rows.guide_base_id and e.name = 'reader_opened'
          and e.received_at >= p_from::timestamp at time zone 'UTC' and e.received_at < (p_to + 1)::timestamp at time zone 'UTC') accounts on true;

  select coalesce(jsonb_agg(jsonb_build_object('objective_id',rows.objective_id,'title',r.title,'starts',rows.starts,'completions',rows.completions,
    'signed_in_learners',case when v_raw and accounts.total >= 5 then accounts.total end) order by rows.starts desc, rows.objective_id),'[]'::jsonb)
    into v_objectives from (
      select objective_id,coalesce(sum(event_count) filter(where name = 'objective_started'),0) as starts,
        coalesce(sum(event_count) filter(where name = 'objective_completed'),0) as completions
      from public.analytics_report_events(v_from,v_to) where objective_id is not null and v_available
        and name in ('objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened')
      group by objective_id order by starts desc,objective_id limit 50
    ) rows left join public.objectives o on o.id = rows.objective_id and o.status = 'published'
      left join public.objective_revisions r on r.id = o.current_revision_id
      left join lateral(select count(distinct e.user_id) as total from public.analytics_events e
        where e.objective_id = rows.objective_id and e.name in ('objective_started','objective_resumed','objective_step_moved','objective_completed','objective_reopened')
          and e.received_at >= p_from::timestamp at time zone 'UTC' and e.received_at < (p_to + 1)::timestamp at time zone 'UTC') accounts on true;

  v_sections := jsonb_build_array(
    jsonb_build_object('key','discovery','title','Discovery','metrics',v_discovery),
    jsonb_build_object('key','reading','title','Reading','metrics',v_reading),
    jsonb_build_object('key','learning','title','Learning','metrics',v_learning),
    jsonb_build_object('key','editorial','title','Editorial health','metrics',v_editorial),
    jsonb_build_object('key','reliability','title','Reliability','metrics',v_reliability)
  );
  return jsonb_build_object('range',jsonb_build_object('from',p_from,'to',p_to,'timezone','UTC','raw_retention_days',90,'aggregate_retention_days',365),
    'enabled',v_enabled,'collection_started_at',v_started,
    'observation',jsonb_build_object('status',v_status,'reason',v_reason),
    'sections',v_sections,'daily',v_daily,'guides',v_guides,'objectives',v_objectives);
end;
$$;
revoke all on function public.analytics_report(date,date) from public, anon, authenticated;
grant execute on function public.analytics_report(date,date) to authenticated;
