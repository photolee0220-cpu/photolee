-- 일일보고 사진: 기록을 먼저 지운 뒤에도 올린 사람(또는 관리자)이 저장소 파일을 지울 수 있게,
-- 자기 폴더({작성자}/...)의 파일은 본인과 관리자가 항상 볼 수 있게 한다
drop policy if exists "daily photos read" on storage.objects;
create policy "daily photos read" on storage.objects for select to authenticated
  using (bucket_id = 'daily-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
    or exists (select 1 from public.daily_photos p where p.storage_path = name)));
