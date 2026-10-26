-- 사닥다리 주간보고 시스템 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 한 번 실행합니다.

create extension if not exists pgcrypto;

-- ───────────── 테이블 ─────────────
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  writes_sites boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  name text not null,
  title text not null default '',
  department_id uuid references public.departments (id),
  is_ceo boolean not null default false,
  is_admin boolean not null default false,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.dept_view_grants (
  viewer_department_id uuid not null references public.departments (id) on delete cascade,
  target_department_id uuid not null references public.departments (id) on delete cascade,
  primary key (viewer_department_id, target_department_id),
  check (viewer_department_id <> target_department_id)
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text not null default '',
  stage text not null check (stage in ('construction', 'cm', 'sales')),
  due_date date,
  due_text text not null default '',
  process text not null default '',
  progress numeric check (progress between 0 and 100),
  scale text not null default '',
  tags text[] not null default '{}',
  sort int not null default 0,
  archived boolean not null default false,
  completed_at date,
  updated_at timestamptz not null default now()
);

create table public.weeks (
  id date primary key,
  created_at timestamptz not null default now()
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id),
  kind text not null check (kind in ('site', 'dept', 'misc')),
  site_id uuid references public.sites (id),
  department_id uuid not null references public.departments (id),
  author_id uuid references public.members (id),
  content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.members (id)
);
create unique index entries_site_uq on public.entries (week_id, site_id, department_id) where kind = 'site';
create unique index entries_dept_uq on public.entries (week_id, author_id) where kind = 'dept';
create unique index entries_misc_uq on public.entries (week_id, department_id) where kind = 'misc';
create index entries_week_idx on public.entries (week_id);
create index entries_site_idx on public.entries (site_id);

create table public.directives (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id),
  target_kind text not null check (target_kind in ('site', 'member', 'misc')),
  site_id uuid references public.sites (id),
  member_id uuid references public.members (id),
  slot text check (slot in ('ceo_progress', 'requests', 'special')),
  content text not null default '',
  updated_at timestamptz not null default now(),
  unique nulls not distinct (week_id, target_kind, site_id, member_id, slot)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  author_id uuid not null references public.members (id),
  content text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.members (id)
);

-- ───────────── 권한 판단 함수 ─────────────
create or replace function public.current_member() returns public.members
language sql stable security definer set search_path = public as $$
  select * from public.members where id = auth.uid() and active
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid() and active)
$$;

create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_ceo from public.members where id = auth.uid() and active), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.members where id = auth.uid() and active), false)
$$;

create or replace function public.my_department() returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.members where id = auth.uid() and active
$$;

create or replace function public.can_view_dept(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ceo() or public.is_admin()
    or d = public.my_department()
    or exists (select 1 from public.dept_view_grants g
               where g.viewer_department_id = public.my_department() and g.target_department_id = d)
$$;

create or replace function public.can_edit_entry(p_kind text, p_dept uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (p_kind = 'dept' and p_author = auth.uid())
    or (p_kind in ('site', 'misc') and p_dept = public.my_department())
$$;

-- ───────────── 행 단위 보안 ─────────────
alter table public.departments enable row level security;
alter table public.members enable row level security;
alter table public.dept_view_grants enable row level security;
alter table public.sites enable row level security;
alter table public.weeks enable row level security;
alter table public.entries enable row level security;
alter table public.directives enable row level security;
alter table public.comments enable row level security;

create policy "read" on public.departments for select to authenticated using (public.is_member());
create policy "admin write" on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read" on public.members for select to authenticated using (public.is_member());
create policy "admin update" on public.members for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read" on public.dept_view_grants for select to authenticated using (public.is_member());
create policy "admin write" on public.dept_view_grants for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read" on public.sites for select to authenticated using (public.is_member());
create policy "admin write" on public.sites for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "read" on public.weeks for select to authenticated using (public.is_member());

create policy "read" on public.entries for select to authenticated using (public.can_view_dept(department_id));

create policy "read" on public.directives for select to authenticated using (
  public.is_ceo() or public.is_admin()
  or (target_kind = 'site' and public.is_member())
  or (target_kind = 'misc' and slot = 'special' and public.is_member())
  or (target_kind = 'member' and public.can_view_dept((select department_id from public.members m where m.id = member_id)))
);

create policy "read" on public.comments for select to authenticated using (
  exists (select 1 from public.entries e where e.id = entry_id and public.can_view_dept(e.department_id))
);
create policy "delete own" on public.comments for delete to authenticated using (author_id = auth.uid());

-- ───────────── 쓰기 함수 (권한 확인 포함) ─────────────
create or replace function public.ensure_week(p_week date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception '로그인이 필요합니다.'; end if;
  if extract(isodow from p_week) <> 1 then raise exception '보고일은 월요일이어야 합니다.'; end if;
  insert into public.weeks (id) values (p_week) on conflict do nothing;
end $$;

create or replace function public.save_entry(p_week date, p_kind text, p_site uuid, p_dept uuid, p_author uuid, p_content text)
returns public.entries
language plpgsql security definer set search_path = public as $$
declare r public.entries;
begin
  if p_kind = 'dept' then
    select department_id into p_dept from public.members where id = p_author;
  end if;
  if p_dept is null or not public.can_edit_entry(p_kind, p_dept, p_author) then raise exception '이 칸을 수정할 권한이 없습니다.'; end if;
  perform public.ensure_week(p_week);
  select * into r from public.entries e where e.week_id = p_week and e.kind = p_kind and (
    (p_kind = 'site' and e.site_id = p_site and e.department_id = p_dept)
    or (p_kind = 'dept' and e.author_id = p_author)
    or (p_kind = 'misc' and e.department_id = p_dept)) for update;
  if found then
    update public.entries set content = p_content, updated_at = now(), updated_by = auth.uid() where id = r.id returning * into r;
  else
    insert into public.entries (week_id, kind, site_id, department_id, author_id, content, updated_by)
    values (p_week, p_kind, case when p_kind = 'site' then p_site end, p_dept, case when p_kind = 'dept' then p_author end, p_content, auth.uid())
    returning * into r;
  end if;
  return r;
end $$;

create or replace function public.save_directive(p_week date, p_target text, p_site uuid, p_member uuid, p_slot text, p_content text)
returns public.directives
language plpgsql security definer set search_path = public as $$
declare r public.directives;
begin
  if not public.is_ceo() then raise exception '대표님 지시사항은 대표님만 입력할 수 있습니다.'; end if;
  perform public.ensure_week(p_week);
  insert into public.directives (week_id, target_kind, site_id, member_id, slot, content)
  values (p_week, p_target, p_site, p_member, p_slot, p_content)
  on conflict (week_id, target_kind, site_id, member_id, slot)
  do update set content = excluded.content, updated_at = now()
  returning * into r;
  return r;
end $$;

create or replace function public.add_comment(p_entry uuid, p_content text) returns public.comments
language plpgsql security definer set search_path = public as $$
declare e public.entries; r public.comments;
begin
  select * into e from public.entries where id = p_entry;
  if not found then raise exception '보고 내용을 찾을 수 없습니다.'; end if;
  if not (public.is_ceo() or public.can_edit_entry(e.kind, e.department_id, e.author_id)) then
    raise exception '피드백을 남길 권한이 없습니다.';
  end if;
  insert into public.comments (entry_id, author_id, content) values (p_entry, auth.uid(), p_content) returning * into r;
  return r;
end $$;

create or replace function public.acknowledge_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.entries;
begin
  select en.* into e from public.comments c join public.entries en on en.id = c.entry_id where c.id = p_comment;
  if not found or not public.can_edit_entry(e.kind, e.department_id, e.author_id) then
    raise exception '확인 처리할 권한이 없습니다.';
  end if;
  update public.comments set acknowledged_at = now(), acknowledged_by = auth.uid() where id = p_comment;
end $$;

create or replace function public.password_changed() returns void
language sql security definer set search_path = public as $$
  update public.members set must_change_password = false where id = auth.uid()
$$;

create or replace function public.set_grants(p_viewer uuid, p_targets uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다.'; end if;
  delete from public.dept_view_grants where viewer_department_id = p_viewer;
  insert into public.dept_view_grants (viewer_department_id, target_department_id)
  select p_viewer, t from unnest(p_targets) t where t <> p_viewer;
end $$;

-- 주차 목록과 작성 현황 (권한 범위 안에서만 집계)
create or replace function public.week_summaries() returns table (week_id date, entry_count bigint, writers bigint)
language sql stable security invoker set search_path = public as $$
  select w.id, count(e.id) filter (where e.content <> ''), count(distinct e.updated_by) filter (where e.content <> '')
  from public.weeks w left join public.entries e on e.week_id = w.id
  group by w.id order by w.id desc
$$;

revoke all on function public.save_entry, public.save_directive, public.add_comment, public.acknowledge_comment,
  public.password_changed, public.set_grants, public.ensure_week from public, anon;
grant execute on function public.save_entry, public.save_directive, public.add_comment, public.acknowledge_comment,
  public.password_changed, public.set_grants, public.ensure_week, public.week_summaries to authenticated;

-- 실시간 반영
alter publication supabase_realtime add table public.entries, public.directives, public.comments, public.sites;
