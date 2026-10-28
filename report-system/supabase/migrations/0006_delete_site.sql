-- 관리자 현장 삭제: 그 현장의 보고·지시·피드백·사진·첨부 기록까지 함께 지운다
-- 저장소 파일은 화면(관리자)이 먼저 지운 뒤 이 함수를 부른다
create or replace function public.delete_site(p_site uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  n_entries int;
  n_directives int;
  n_photos int;
  n_files int;
begin
  if not public.is_admin() then raise exception '관리자만 현장을 삭제할 수 있습니다.'; end if;
  if not exists (select 1 from public.sites where id = p_site) then raise exception '현장을 찾을 수 없습니다.'; end if;
  delete from public.entries where site_id = p_site;  -- 피드백은 함께 지워진다 (on delete cascade)
  get diagnostics n_entries = row_count;
  delete from public.directives where site_id = p_site;
  get diagnostics n_directives = row_count;
  delete from public.photos where site_id = p_site;
  get diagnostics n_photos = row_count;
  delete from public.attachments where site_id = p_site;
  get diagnostics n_files = row_count;
  delete from public.sites where id = p_site;
  return json_build_object('entries', n_entries, 'directives', n_directives, 'photos', n_photos, 'files', n_files);
end $$;
grant execute on function public.delete_site(uuid) to authenticated;
