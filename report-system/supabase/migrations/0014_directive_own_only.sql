-- 개인 지시는 본인과 대표·관리자·본부장만 읽는다.
-- 부서 공유(dept_view_grants)는 주간보고 내용만 함께 보고, 남의 개인 지시는 보이지 않는다.
-- 현장 지시는 그대로 모든 직원이 읽는다 (현장 보고 작성 화면에 필요).
drop policy if exists "read" on public.directives;
create policy "read" on public.directives for select to authenticated using (
  public.is_ceo() or public.is_admin() or public.is_executive()
  or (target_kind = 'site' and public.is_member())
  or (target_kind = 'misc' and slot = 'special' and public.is_member())
  or (target_kind = 'member' and member_id = auth.uid())
);
