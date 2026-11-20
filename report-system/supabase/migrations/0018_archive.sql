-- 전체 자료실: 모든 채팅방(1:1 제외)·현장 서류·일일보고·주간보고의 사진과 파일을 한곳에서
--  · 대표님·관리자는 늘, 그 밖에는 관리자가 소통 설정(archiveViewers)에 넣은 사람만
--  · 1:1 대화, 지운·가린 메시지, 부서 안 보고 사진은 넣지 않는다
--  · 파일은 복사하지 않고 원래 자리의 파일을 가리킨다

create or replace function public.can_see_archive() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_member() and (
    public.is_ceo() or public.is_admin()
    or coalesce(public.talk_setting('archiveViewers'), '[]'::jsonb) ? auth.uid()::text
  ), false)
$$;

-- 자료실에 들어가는 파일인지 (저장소 읽기 권한에 쓴다)
create or replace function public.archive_object_ok(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_bucket
    when 'talk-files' then
      ((storage.foldername(p_name))[1] = 'room' and exists (
        select 1 from public.chat_rooms r where r.id = public.try_uuid((storage.foldername(p_name))[2]) and r.kind <> 'dm'))
      or exists (select 1 from public.site_docs d where d.storage_path = p_name)
    when 'daily-photos' then exists (select 1 from public.daily_photos p where p.storage_path = p_name and not p.internal)
    when 'site-photos' then exists (select 1 from public.photos p where p.storage_path = p_name)
    when 'report-files' then exists (select 1 from public.attachments a where a.storage_path = p_name)
    else false
  end
$$;

create policy "archive read" on storage.objects for select to authenticated
  using (bucket_id in ('talk-files', 'daily-photos', 'site-photos', 'report-files')
    and public.can_see_archive() and public.archive_object_ok(bucket_id, name));

-- 목록 (최근 것부터 4000개)
create or replace function public.archive_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_archive() then raise exception '전체 자료실을 볼 권한이 없습니다.'; end if;
  return coalesce((select jsonb_agg(x order by x->>'at' desc) from (
    select x from (
      -- 채팅 (1:1·지운·가린 메시지 제외)
      select jsonb_build_object('id', m.id::text || ':' || coalesce(a->>'id', a->>'path'), 'kind', case when a->>'kind' = 'image' then 'photo' else 'file' end,
        'name', coalesce(a->>'name', '파일'), 'bucket', 'talk-files', 'path', a->>'path', 'size', coalesce((a->>'size')::bigint, 0), 'at', m.created_at,
        'authorId', m.author_id, 'source', 'chat', 'siteId', r.site_id, 'roomId', r.id, 'roomName', r.name, 'messageId', m.id, 'category', m.doc_category) as x
      from public.chat_messages m
      join public.chat_rooms r on r.id = m.room_id and r.kind <> 'dm'
      cross join lateral jsonb_array_elements(m.attachments) a
      where not m.deleted and m.hidden_at is null and coalesce(a->>'path', '') <> ''
      union all
      -- 자료실에 직접 올린 현장 서류 (채팅으로 올린 것은 위에 있다)
      select jsonb_build_object('id', d.id, 'kind', case when d.file_type = 'image' then 'photo' else 'file' end,
        'name', case when d.title = d.category then d.category || '_' || d.doc_date::text else d.title end || coalesce(substring(d.file_name from '\.[A-Za-z0-9]+$'), ''),
        'bucket', 'talk-files', 'path', d.storage_path, 'size', d.size, 'at', d.created_at, 'authorId', d.uploaded_by, 'source', 'doc',
        'siteId', d.site_id, 'roomId', null, 'roomName', null, 'messageId', null, 'category', d.category)
      from public.site_docs d where d.message_id is null
      union all
      -- 일일보고 사진 (부서 안 보고 제외)
      select jsonb_build_object('id', p.id, 'kind', 'photo', 'name', '일일보고_' || p.date::text || '.jpg', 'bucket', 'daily-photos', 'path', p.storage_path,
        'size', p.size_bytes, 'at', p.created_at, 'authorId', p.author_id, 'source', 'daily', 'siteId', p.site_id, 'roomId', null, 'roomName', null, 'messageId', null, 'category', null)
      from public.daily_photos p where not p.internal
      union all
      -- 주간보고 사진
      select jsonb_build_object('id', p.id, 'kind', 'photo', 'name', coalesce(nullif(p.caption, ''), '주간보고 사진') || '.jpg', 'bucket', 'site-photos', 'path', p.storage_path,
        'size', 0, 'at', p.created_at, 'authorId', p.uploaded_by, 'source', 'weekly', 'siteId', p.site_id, 'roomId', null, 'roomName', null, 'messageId', null, 'category', null)
      from public.photos p
      union all
      -- 주간보고 첨부파일
      select jsonb_build_object('id', a.id, 'kind', 'file', 'name', a.file_name, 'bucket', 'report-files', 'path', a.storage_path,
        'size', a.size_bytes, 'at', a.created_at, 'authorId', coalesce(a.author_id, a.uploaded_by), 'source', 'weekly', 'siteId', a.site_id, 'roomId', null, 'roomName', null, 'messageId', null, 'category', null)
      from public.attachments a
    ) u
    order by x->>'at' desc
    limit 4000
  ) t), '[]'::jsonb);
end $$;

revoke all on function public.can_see_archive(), public.archive_object_ok(text, text), public.archive_list() from public, anon;
grant execute on function public.can_see_archive(), public.archive_object_ok(text, text), public.archive_list() to authenticated;
