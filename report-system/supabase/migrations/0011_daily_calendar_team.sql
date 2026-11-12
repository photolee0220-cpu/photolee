-- 사닥다리 업무보고 시스템: 일일보고, 근무 상태, 캘린더, 부서 안 보고, 피드백 수정

-- ───────────── 인원·부서 ─────────────
alter table public.members
  add column if not exists affiliation text not null default 'hq' check (affiliation in ('hq', 'site')),
  add column if not exists home_site_id uuid references public.sites (id) on delete set null,
  add column if not exists daily_enabled boolean not null default true;

-- 부서 안 보고: 부서원은 대표님이 아니라 부서장에게 일일보고만 쓴다
alter table public.departments
  add column if not exists internal_report boolean not null default false,
  add column if not exists head_id uuid references public.members (id) on delete set null;

-- 확인 전까지 피드백을 고칠 수 있다 (고친 시각)
alter table public.comments add column if not exists edited_at timestamptz;

-- ───────────── 판단 함수 ─────────────
create or replace function public.today_kst() returns date
language sql stable as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 부서 안 보고 부서의 부서원 (부서장 제외)
create or replace function public.is_internal_member(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select d.internal_report and d.head_id is distinct from m.id
    from public.members m join public.departments d on d.id = m.department_id
    where m.id = p_member), false)
$$;

-- 일일보고 한 칸을 볼 수 있는지: 부서원 보고는 그 부서 안과 관리자만, 나머지는 부서 열람 규칙대로
create or replace function public.can_see_daily(p_author uuid, p_dept uuid, p_internal boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    p_author = auth.uid()
      or (p_internal and (public.is_admin() or p_dept = public.my_department()))
      or (not p_internal and public.can_view_dept(p_dept)),
    false)
$$;

-- 이 사람의 일일보고(근무 상태·피드백 포함)를 볼 수 있는지
create or replace function public.can_see_member_daily(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.can_see_daily(m.id, m.department_id, public.is_internal_member(m.id))
    from public.members m where m.id = p_member), false)
$$;

-- 피드백(확인 요청)을 남길 수 있는지: 부서원은 부서장, 그 밖에는 대표·본부장
create or replace function public.can_review_daily(p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    p_target <> auth.uid() and case
      when public.is_internal_member(p_target) then exists (
        select 1 from public.members m join public.departments d on d.id = m.department_id
        where m.id = p_target and d.head_id = auth.uid())
      else public.is_ceo() or public.is_executive()
    end,
    false)
$$;

-- 근무 상태 등록: 본인, 관리자, 그 사람 부서의 부서장
create or replace function public.can_set_status(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin() or p_member = auth.uid() or exists (
      select 1 from public.members m join public.departments d on d.id = m.department_id
      where m.id = p_member and d.head_id = auth.uid()),
    false)
$$;

-- ───────────── 일일보고 ─────────────
create table public.daily_reports (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  author_id uuid not null references public.members (id) on delete cascade,
  department_id uuid not null references public.departments (id),
  site_id uuid references public.sites (id) on delete cascade,
  author_kind text not null check (author_kind in ('hq', 'site')),
  internal boolean not null default false,
  content text not null default '',
  updated_at timestamptz not null default now()
);
create unique index daily_reports_uq on public.daily_reports (author_id, date, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index daily_reports_date_idx on public.daily_reports (date);
alter table public.daily_reports enable row level security;
create policy "read" on public.daily_reports for select to authenticated using (public.can_see_daily(author_id, department_id, internal));

create table public.daily_photos (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  author_id uuid not null references public.members (id) on delete cascade,
  department_id uuid not null references public.departments (id),
  site_id uuid references public.sites (id) on delete cascade,
  internal boolean not null default false,
  storage_path text not null unique,
  width int not null default 0,
  height int not null default 0,
  size_bytes bigint not null default 0,
  created_at timestamptz not null default now()
);
create index daily_photos_date_idx on public.daily_photos (date);
alter table public.daily_photos enable row level security;
create policy "read" on public.daily_photos for select to authenticated using (public.can_see_daily(author_id, department_id, internal));

create table public.daily_comments (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  member_id uuid not null references public.members (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  acknowledged_at timestamptz
);
create index daily_comments_member_idx on public.daily_comments (member_id, date);
alter table public.daily_comments enable row level security;
create policy "read" on public.daily_comments for select to authenticated using (author_id = auth.uid() or public.can_see_member_daily(member_id));
create policy "delete own" on public.daily_comments for delete to authenticated using (author_id = auth.uid());

-- 일일보고 저장: 본인 칸만, 당일에만 (관리자는 언제나). 내용을 비우면 칸을 지운다
create or replace function public.save_daily(p_date date, p_site uuid, p_content text) returns public.daily_reports
language plpgsql security definer set search_path = public as $$
declare m public.members; r public.daily_reports;
begin
  select * into m from public.members where id = auth.uid() and active;
  if not found or m.department_id is null or m.is_ceo or m.is_executive or not m.daily_enabled then
    raise exception '일일보고를 쓰는 계정이 아닙니다.';
  end if;
  if p_date <> public.today_kst() and not m.is_admin then raise exception '일일보고는 당일에만 수정할 수 있습니다.'; end if;
  if m.affiliation = 'site' and p_site is distinct from m.home_site_id then
    raise exception '소속 현장 칸에만 쓸 수 있습니다. 관리자에게 소속 현장 지정을 요청하세요.';
  end if;
  select * into r from public.daily_reports
   where author_id = m.id and date = p_date and site_id is not distinct from p_site for update;
  if coalesce(btrim(p_content), '') = '' then
    if found then delete from public.daily_reports where id = r.id; end if;
    return null;
  end if;
  if found then
    update public.daily_reports set content = p_content, updated_at = now() where id = r.id returning * into r;
  else
    insert into public.daily_reports (date, author_id, department_id, site_id, author_kind, internal, content)
    values (p_date, m.id, m.department_id, p_site, m.affiliation, public.is_internal_member(m.id), p_content)
    returning * into r;
  end if;
  return r;
end $$;

-- 사진: 저장소에 올린 뒤 기록을 남긴다 (당일에만)
create or replace function public.add_daily_photo(p_date date, p_site uuid, p_path text, p_width int, p_height int, p_size bigint)
returns public.daily_photos
language plpgsql security definer set search_path = public as $$
declare m public.members; r public.daily_photos;
begin
  select * into m from public.members where id = auth.uid() and active;
  if not found or m.department_id is null or not m.daily_enabled then raise exception '일일보고를 쓰는 계정이 아닙니다.'; end if;
  if p_date <> public.today_kst() and not m.is_admin then raise exception '일일보고는 당일에만 수정할 수 있습니다.'; end if;
  if split_part(p_path, '/', 1) <> m.id::text then raise exception '잘못된 사진 경로입니다.'; end if;
  insert into public.daily_photos (date, author_id, department_id, site_id, internal, storage_path, width, height, size_bytes)
  values (p_date, m.id, m.department_id, p_site, public.is_internal_member(m.id), p_path, p_width, p_height, p_size)
  returning * into r;
  return r;
end $$;

create or replace function public.delete_daily_photo(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p public.daily_photos;
begin
  select * into p from public.daily_photos where id = p_id;
  if not found then raise exception '사진을 찾을 수 없습니다.'; end if;
  if not (public.is_admin() or (p.author_id = auth.uid() and p.date = public.today_kst())) then
    raise exception '올린 사람이 당일에만 지울 수 있습니다.';
  end if;
  delete from public.daily_photos where id = p_id;
  return p.storage_path;
end $$;

-- 피드백: 쓴 보고에만. 부서원은 부서장, 그 밖에는 대표·본부장. 본인은 답글
create or replace function public.add_daily_comment(p_date date, p_member uuid, p_content text) returns public.daily_comments
language plpgsql security definer set search_path = public as $$
declare r public.daily_comments;
begin
  if coalesce(btrim(p_content), '') = '' then raise exception '내용을 입력해 주세요.'; end if;
  if not (p_member = auth.uid() or public.can_review_daily(p_member)) then raise exception '피드백을 남길 권한이 없습니다.'; end if;
  if not exists (select 1 from public.daily_reports where author_id = p_member and date = p_date and content <> '')
     and not exists (select 1 from public.daily_photos where author_id = p_member and date = p_date) then
    raise exception '작성한 일일보고에만 피드백을 남길 수 있습니다.';
  end if;
  insert into public.daily_comments (date, member_id, author_id, content) values (p_date, p_member, auth.uid(), p_content) returning * into r;
  return r;
end $$;

create or replace function public.edit_daily_comment(p_id uuid, p_content text) returns public.daily_comments
language plpgsql security definer set search_path = public as $$
declare r public.daily_comments;
begin
  select * into r from public.daily_comments where id = p_id for update;
  if not found or r.author_id <> auth.uid() then raise exception '본인이 쓴 글만 고칠 수 있습니다.'; end if;
  if r.acknowledged_at is not null then raise exception '상대가 이미 확인해서 고칠 수 없습니다.'; end if;
  if coalesce(btrim(p_content), '') = '' then raise exception '내용을 입력해 주세요.'; end if;
  update public.daily_comments set content = p_content, edited_at = now() where id = p_id returning * into r;
  return r;
end $$;

create or replace function public.ack_daily_comment(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.daily_comments set acknowledged_at = now() where id = p_id and member_id = auth.uid() and acknowledged_at is null;
  if not found and not exists (select 1 from public.daily_comments where id = p_id and member_id = auth.uid()) then
    raise exception '본인 보고에 달린 피드백만 확인할 수 있습니다.';
  end if;
end $$;

-- 주간보고 피드백도 확인 전까지 고친다
create or replace function public.edit_comment(p_id uuid, p_content text) returns public.comments
language plpgsql security definer set search_path = public as $$
declare r public.comments;
begin
  select * into r from public.comments where id = p_id for update;
  if not found or r.author_id <> auth.uid() then raise exception '본인이 쓴 글만 고칠 수 있습니다.'; end if;
  if r.acknowledged_at is not null then raise exception '상대가 이미 확인해서 고칠 수 없습니다.'; end if;
  if coalesce(btrim(p_content), '') = '' then raise exception '내용을 입력해 주세요.'; end if;
  update public.comments set content = p_content, edited_at = now() where id = p_id returning * into r;
  return r;
end $$;

-- ───────────── 근무 상태 (연차·반차·휴가·출장·교육·휴무) ─────────────
create table public.day_status (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  kind text not null check (kind in ('annual', 'half', 'vacation', 'trip', 'training', 'off')),
  memo text not null default '',
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index day_status_range_idx on public.day_status (start_date, end_date);
alter table public.day_status enable row level security;
create policy "read" on public.day_status for select to authenticated using (public.can_see_member_daily(member_id));
create policy "insert" on public.day_status for insert to authenticated with check (public.can_set_status(member_id) and created_by = auth.uid());
create policy "update" on public.day_status for update to authenticated using (public.can_set_status(member_id)) with check (public.can_set_status(member_id));
create policy "delete" on public.day_status for delete to authenticated using (public.can_set_status(member_id));

-- ───────────── 캘린더 ─────────────
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> ''),
  start_date date not null,
  end_date date not null,
  time text not null default '',
  site_id uuid references public.sites (id) on delete set null,
  scope text not null check (scope in ('dept', 'all')),
  department_id uuid references public.departments (id) on delete set null,
  memo text not null default '',
  created_by uuid references public.members (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (scope = 'all' or department_id is not null)
);
create index calendar_events_range_idx on public.calendar_events (start_date, end_date);
alter table public.calendar_events enable row level security;
create policy "read" on public.calendar_events for select to authenticated
  using (scope = 'all' or created_by = auth.uid() or coalesce(public.can_view_dept(department_id), false));
create policy "insert" on public.calendar_events for insert to authenticated
  with check (public.is_member() and created_by = auth.uid() and department_id is not distinct from public.my_department());
create policy "update" on public.calendar_events for update to authenticated
  using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
create policy "delete" on public.calendar_events for delete to authenticated using (created_by = auth.uid() or public.is_admin());

-- ───────────── 사진 저장소 ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('daily-photos', 'daily-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
-- 경로: {작성자}/{날짜}/{파일}. 기록(daily_photos)을 볼 수 있는 사람만 읽는다
create policy "daily photos read" on storage.objects for select to authenticated
  using (bucket_id = 'daily-photos' and exists (select 1 from public.daily_photos p where p.storage_path = name));
create policy "daily photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'daily-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "daily photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'daily-photos' and (owner = auth.uid() or public.is_admin()));

-- ───────────── 알림 ─────────────
-- 일일보고 피드백: 본인 말고 다른 사람(대표·본부장·부서장)이 남기면 알림
create or replace function public.notify_daily_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id <> new.member_id then
    perform public.call_notify(jsonb_build_object('action', 'daily-feedback', 'commentId', new.id));
  end if;
  return new;
end $$;
create trigger daily_comments_notify after insert on public.daily_comments
  for each row execute function public.notify_daily_comment();

-- 평일 오후 6시(한국 시간) 일일보고 마감 알림
do $$
begin
  perform cron.unschedule('daily-deadline') where exists (select 1 from cron.job where jobname = 'daily-deadline');
  perform cron.schedule('daily-deadline', '0 9 * * 1-5', 'select public.call_notify(''{"action":"daily-deadline"}''::jsonb)');
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- ───────────── 백업에 새 기록 포함 ─────────────
create or replace function public.make_backup(p_kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  doc jsonb;
  new_id bigint;
begin
  doc := jsonb_build_object(
    'version', 3,
    'created_at', now(),
    'tables', jsonb_build_object(
      'departments', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.departments t),
      'members', (select coalesce(jsonb_agg(t order by t.name), '[]') from public.members t),
      'dept_view_grants', (select coalesce(jsonb_agg(t), '[]') from public.dept_view_grants t),
      'stages', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.stages t),
      'site_fields', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.site_fields t),
      'sites', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.sites t),
      'weeks', (select coalesce(jsonb_agg(t order by t.id), '[]') from public.weeks t),
      'entries', (select coalesce(jsonb_agg(t order by t.week_id), '[]') from public.entries t),
      'directives', (select coalesce(jsonb_agg(t order by t.week_id), '[]') from public.directives t),
      'comments', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.comments t),
      'photos', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.photos t),
      'attachments', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.attachments t),
      'daily_reports', (select coalesce(jsonb_agg(t order by t.date), '[]') from public.daily_reports t),
      'daily_photos', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.daily_photos t),
      'daily_comments', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.daily_comments t),
      'day_status', (select coalesce(jsonb_agg(t order by t.start_date), '[]') from public.day_status t),
      'calendar_events', (select coalesce(jsonb_agg(t order by t.start_date), '[]') from public.calendar_events t),
      'ai_summaries', (select coalesce(jsonb_agg(t), '[]') from public.ai_summaries t),
      'app_settings', (select coalesce(jsonb_agg(t), '[]') from public.app_settings t)
    )
  );
  insert into public.backups (kind, created_by, size_bytes, data)
  values (p_kind, auth.uid(), octet_length(doc::text), doc) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by created_at desc limit 12);
  return new_id;
end $$;
revoke all on function public.make_backup(text) from public, anon, authenticated;

-- ───────────── 실행 권한·실시간 ─────────────
revoke all on function public.save_daily(date, uuid, text), public.add_daily_photo(date, uuid, text, int, int, bigint), public.delete_daily_photo(uuid),
  public.add_daily_comment(date, uuid, text), public.edit_daily_comment(uuid, text), public.ack_daily_comment(uuid), public.edit_comment(uuid, text)
  from public, anon;
grant execute on function public.save_daily(date, uuid, text), public.add_daily_photo(date, uuid, text, int, int, bigint), public.delete_daily_photo(uuid),
  public.add_daily_comment(date, uuid, text), public.edit_daily_comment(uuid, text), public.ack_daily_comment(uuid), public.edit_comment(uuid, text)
  to authenticated;

alter publication supabase_realtime add table public.daily_reports, public.daily_photos, public.daily_comments, public.day_status, public.calendar_events;

insert into public.app_settings (key, value) values ('layers_url', '""') on conflict (key) do nothing;
