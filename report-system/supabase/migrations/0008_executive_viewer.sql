-- 전체 열람·코멘트 권한 (예: 건설 본부장). 보고는 쓰지 않고 모든 보고를 보며 코멘트를 남긴다

alter table public.members add column is_executive boolean not null default false;

create or replace function public.is_executive() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_executive from public.members where id = auth.uid() and active), false)
$$;

-- 모든 부서 보고·사진·첨부·수정 기록을 볼 수 있다 (AI 요약은 대표 전용이라 그대로 못 봄)
create or replace function public.can_view_dept(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ceo() or public.is_admin() or public.is_executive()
    or d = public.my_department()
    or exists (select 1 from public.dept_view_grants g
               where g.viewer_department_id = public.my_department() and g.target_department_id = d)
$$;

-- 대표처럼 어느 보고 칸에나 코멘트를 남긴다
create or replace function public.add_comment(p_entry uuid, p_content text) returns public.comments
language plpgsql security definer set search_path = public as $$
declare e public.entries; r public.comments;
begin
  select * into e from public.entries where id = p_entry;
  if not found then raise exception '보고 내용을 찾을 수 없습니다.'; end if;
  if not (public.is_ceo() or public.is_executive() or public.can_edit_entry(e.kind, e.department_id, e.author_id)) then
    raise exception '피드백을 남길 권한이 없습니다.';
  end if;
  insert into public.comments (entry_id, author_id, content) values (p_entry, auth.uid(), p_content) returning * into r;
  return r;
end $$;

-- 본부장 코멘트도 담당자에게 알림
create or replace function public.notify_ceo_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.members m where m.id = new.author_id and (m.is_ceo or m.is_executive)) then
    perform public.call_notify(jsonb_build_object('action', 'feedback', 'commentId', new.id));
  end if;
  return new;
end $$;

-- 부서가 없는 계정(대표·본부장·취합 관리자)은 my_department()가 비어 있어 비교 결과가 NULL이 되고,
-- save_entry의 'if not can_edit_entry' 검사를 통과해 버렸다. 항상 참/거짓으로 답하게 한다
create or replace function public.can_edit_entry(p_kind text, p_dept uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_admin()
      or (p_kind = 'dept' and p_author = auth.uid())
      or (p_kind = 'site' and p_dept = public.my_department()),
    false)
$$;

create or replace function public.can_view_dept(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_ceo() or public.is_admin() or public.is_executive()
      or d = public.my_department()
      or exists (select 1 from public.dept_view_grants g
                 where g.viewer_department_id = public.my_department() and g.target_department_id = d),
    false)
$$;
