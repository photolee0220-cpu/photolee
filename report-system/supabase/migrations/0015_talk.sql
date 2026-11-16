-- 소통: 전체 공지, 채팅방(관리자가 만든 방·현장방·문의방·안전방·1:1), 현장 자료실, 신규 교회건축 문의, 안전 전달 제안
-- 원칙
--  · 채팅은 방 인원만 읽는다. 1:1은 두 사람만 (관리자도 못 봄)
--  · 쓰기는 모두 아래 함수(RPC)로만 한다: 권한·기록을 한곳에서 확인
--  · 관리자가 가린 메시지는 본문을 따로 옮겨 두고 방에는 빈 글만 남긴다 (실시간으로도 새지 않게)

-- ───────────── 설정 ─────────────
insert into public.app_settings (key, value) values ('talk', jsonb_build_object(
  'quiet', jsonb_build_object('enabled', true, 'from', '22:00', 'to', '07:00'),
  'deleteMinutes', 5,
  'adminCanNotice', false,
  'docCategories', jsonb_build_array('회의록', '공사일보', '주간공정표', '월간공정표', '기타')
)) on conflict (key) do nothing;

create or replace function public.talk_setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value -> k from public.app_settings where key = 'talk'
$$;

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ───────────── 표 ─────────────
create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group', 'site', 'inquiry', 'safety', 'dm')),
  name text not null default '',
  site_id uuid references public.sites (id) on delete set null,
  pinned text not null default '',
  pinned_by uuid references public.members (id) on delete set null,
  pinned_at timestamptz,
  meeting_dow int check (meeting_dow between 0 and 6),
  sort int not null default 100,
  created_at timestamptz not null default now()
);
-- 문의방·안전방은 하나씩만
create unique index chat_rooms_builtin_uq on public.chat_rooms (kind) where kind in ('inquiry', 'safety');

create table public.chat_room_members (
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  muted boolean not null default false,
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (room_id, member_id)
);
create index chat_room_members_member_idx on public.chat_room_members (member_id);

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  church text not null,
  region text not null default '',
  contact_name text not null default '',
  phone text not null default '',
  scale text not null default '',
  budget text not null default '',
  timing text not null default '',
  source text not null default '',
  stage text not null default 'new' check (stage in ('new', 'consult', 'visit', 'proposal', 'won', 'closed', 'hold', 'lost')),
  owner_id uuid references public.members (id) on delete set null,
  note text not null default '',
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  stale_notified_at timestamptz,
  site_id uuid references public.sites (id) on delete set null
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  author_id uuid not null references public.members (id),
  text text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  reply_to uuid references public.chat_messages (id) on delete set null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false,
  inquiry_id uuid references public.inquiries (id) on delete cascade,
  directive jsonb,
  safety boolean not null default false,
  system boolean not null default false,
  hidden_by uuid references public.members (id) on delete set null,
  hidden_at timestamptz,
  doc_category text
);
create index chat_messages_room_idx on public.chat_messages (room_id, created_at);

-- 고치기 전 글 (관리자 확인용)
create table public.chat_message_edits (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  text text not null,
  edited_by uuid,
  edited_at timestamptz not null default now()
);
-- 관리자가 가린 메시지의 본문
create table public.chat_hidden (
  message_id uuid primary key references public.chat_messages (id) on delete cascade,
  text text not null,
  attachments jsonb not null
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  author_id uuid not null references public.members (id),
  require_ack boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notice_reads (
  notice_id uuid not null references public.notices (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  read_at timestamptz,
  ack_at timestamptz,
  primary key (notice_id, member_id)
);

create table public.site_docs (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites (id) on delete cascade,
  category text not null,
  doc_date date not null,
  title text not null,
  note text not null default '',
  file_name text not null,
  file_type text not null check (file_type in ('pdf', 'image', 'file')),
  storage_path text not null,
  size bigint not null default 0,
  text text not null default '',
  uploaded_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  message_id uuid references public.chat_messages (id) on delete set null
);
create index site_docs_site_idx on public.site_docs (site_id, doc_date desc);

create table public.safety_tips (
  id text primary key,
  date date not null,
  site_id uuid not null references public.sites (id) on delete cascade,
  sources jsonb not null default '[]'::jsonb,
  text text not null,
  room_ids uuid[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'sent', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────── 권한 도우미 ─────────────
create or replace function public.is_room_member(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_room_members where room_id = r and member_id = auth.uid())
$$;

create or replace function public.in_inquiry_room() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_room_members m join public.chat_rooms r on r.id = m.room_id
                 where r.kind = 'inquiry' and m.member_id = auth.uid())
$$;

create or replace function public.can_see_site_docs(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ceo() or public.is_admin() or public.is_executive()
    or exists (select 1 from public.chat_room_members m join public.chat_rooms r on r.id = m.room_id
               where r.kind = 'site' and r.site_id = s and m.member_id = auth.uid())
$$;

create or replace function public.can_write_notice() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ceo() or (public.is_admin() and coalesce((public.talk_setting('adminCanNotice'))::boolean, false))
$$;

-- ───────────── 읽기 권한 ─────────────
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_edits enable row level security;
alter table public.chat_hidden enable row level security;
alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
alter table public.inquiries enable row level security;
alter table public.site_docs enable row level security;
alter table public.safety_tips enable row level security;

create policy "read" on public.chat_rooms for select to authenticated
  using (public.is_room_member(id) or (public.is_admin() and kind <> 'dm'));
create policy "read" on public.chat_room_members for select to authenticated
  using (public.is_room_member(room_id) or (public.is_admin() and exists (select 1 from public.chat_rooms r where r.id = room_id and r.kind <> 'dm')));
create policy "read" on public.chat_messages for select to authenticated using (public.is_room_member(room_id));
create policy "admin read" on public.chat_message_edits for select to authenticated using (public.is_admin());
create policy "admin read" on public.chat_hidden for select to authenticated using (public.is_admin());
create policy "read" on public.notices for select to authenticated using (public.is_member());
create policy "read" on public.notice_reads for select to authenticated
  using (member_id = auth.uid() or public.is_ceo() or public.is_admin());
create policy "read" on public.inquiries for select to authenticated using (public.in_inquiry_room());
create policy "read" on public.site_docs for select to authenticated using (public.can_see_site_docs(site_id));
create policy "ceo" on public.safety_tips for all to authenticated using (public.is_ceo()) with check (public.is_ceo());

-- ───────────── 파일 (채팅 첨부·현장 자료) ─────────────
-- 경로: room/{방}/{파일} 또는 site/{현장}/{파일}
insert into storage.buckets (id, name, public, file_size_limit)
values ('talk-files', 'talk-files', false, 26214400)
on conflict (id) do nothing;

create policy "talk files read" on storage.objects for select to authenticated using (
  bucket_id = 'talk-files' and (
    ((storage.foldername(name))[1] = 'room' and public.is_room_member(public.try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'site' and public.can_see_site_docs(public.try_uuid((storage.foldername(name))[2])))
    or exists (select 1 from public.site_docs d where d.storage_path = name and public.can_see_site_docs(d.site_id))
    or owner = auth.uid() or public.is_admin()
  ));
create policy "talk files upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'talk-files' and (
    ((storage.foldername(name))[1] = 'room' and public.is_room_member(public.try_uuid((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'site' and public.can_see_site_docs(public.try_uuid((storage.foldername(name))[2])))
  ));
create policy "talk files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'talk-files' and (owner = auth.uid() or public.is_admin()));

-- ───────────── 방 목록 (안 읽은 수·마지막 메시지 포함) ─────────────
create or replace function public.talk_rooms() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'lastAt' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'room', to_jsonb(r),
      'memberIds', (select coalesce(jsonb_agg(m.member_id), '[]') from public.chat_room_members m where m.room_id = r.id),
      'mutedBy', (select coalesce(jsonb_agg(m.member_id), '[]') from public.chat_room_members m where m.room_id = r.id and m.muted),
      'reads', (select coalesce(jsonb_object_agg(m.member_id, m.last_read_at), '{}') from public.chat_room_members m where m.room_id = r.id),
      'last', (select to_jsonb(c) from public.chat_messages c where c.room_id = r.id order by c.created_at desc limit 1),
      'lastAt', (select max(c.created_at) from public.chat_messages c where c.room_id = r.id),
      'unread', (select count(*) from public.chat_messages c where c.room_id = r.id and c.author_id <> auth.uid() and c.created_at > me.last_read_at)
    ) as x
    from public.chat_rooms r
    join public.chat_room_members me on me.room_id = r.id and me.member_id = auth.uid()
  ) t
$$;

-- ───────────── 메시지 ─────────────
create or replace function public.post_system(p_room uuid, p_text text, p_reply uuid default null, p_mentions uuid[] default '{}', p_inquiry uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.chat_messages (room_id, author_id, text, system, reply_to, mentions, inquiry_id)
  values (p_room, auth.uid(), p_text, true, p_reply, coalesce(p_mentions, '{}'), p_inquiry) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.post_system(uuid, text, uuid, uuid[], uuid) from public, anon, authenticated;

create or replace function public.send_message(p_room uuid, p_text text, p_attachments jsonb default '[]', p_reply uuid default null,
  p_inquiry uuid default null, p_doc_category text default null, p_docs jsonb default '[]')
returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare
  r public.chat_rooms;
  msg public.chat_messages;
  body text := btrim(coalesce(p_text, ''));
  ments uuid[];
  d jsonb;
begin
  select * into r from public.chat_rooms where id = p_room;
  if not found or not public.is_room_member(p_room) then raise exception '이 방에 들어가 있지 않습니다.'; end if;
  if body = '' and jsonb_array_length(coalesce(p_attachments, '[]')) = 0 then raise exception '보낼 내용을 입력하세요.'; end if;
  if p_inquiry is not null and r.kind <> 'inquiry' then raise exception '문의 대화는 문의방에서만 할 수 있습니다.'; end if;
  select coalesce(array_agg(m.id), '{}') into ments
    from public.members m join public.chat_room_members cm on cm.member_id = m.id and cm.room_id = p_room
    where m.id <> auth.uid() and position('@' || m.name in body) > 0;
  insert into public.chat_messages (room_id, author_id, text, attachments, reply_to, mentions, inquiry_id, doc_category)
  values (p_room, auth.uid(), body, coalesce(p_attachments, '[]'), p_reply, ments, p_inquiry,
          case when p_doc_category is not null and r.site_id is not null and jsonb_array_length(coalesce(p_docs, '[]')) > 0 then p_doc_category end)
  returning * into msg;
  if p_inquiry is not null then update public.inquiries set last_activity_at = now() where id = p_inquiry; end if;
  -- 현장방에서 붙인 파일을 자료실에도 넣는다
  if msg.doc_category is not null then
    for d in select * from jsonb_array_elements(p_docs) loop
      insert into public.site_docs (site_id, category, doc_date, title, note, file_name, file_type, storage_path, size, text, uploaded_by, message_id)
      values (r.site_id, msg.doc_category, (now() at time zone 'Asia/Seoul')::date, coalesce(d->>'title', d->>'name'), left(body, 120),
              d->>'name', coalesce(d->>'fileType', 'file'), d->>'path', coalesce((d->>'size')::bigint, 0), coalesce(d->>'text', ''), auth.uid(), msg.id);
    end loop;
  end if;
  update public.chat_room_members set last_read_at = now() where room_id = p_room and member_id = auth.uid();
  return msg;
end $$;

create or replace function public.edit_message(p_id uuid, p_text text) returns public.chat_messages
language plpgsql security definer set search_path = public as $$
declare msg public.chat_messages;
begin
  select * into msg from public.chat_messages where id = p_id;
  if not found or msg.author_id <> auth.uid() or msg.system then raise exception '본인 메시지만 고칠 수 있습니다.'; end if;
  if msg.deleted or msg.hidden_at is not null then raise exception '지우거나 가린 메시지는 고칠 수 없습니다.'; end if;
  if btrim(coalesce(p_text, '')) = '' then raise exception '내용을 입력하세요.'; end if;
  insert into public.chat_message_edits (message_id, text, edited_by) values (p_id, msg.text, auth.uid());
  update public.chat_messages set text = btrim(p_text), edited_at = now() where id = p_id returning * into msg;
  return msg;
end $$;

create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  msg public.chat_messages;
  mins int := coalesce((public.talk_setting('deleteMinutes'))::int, 5);
begin
  select * into msg from public.chat_messages where id = p_id;
  if not found then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if not public.is_admin() then
    if msg.author_id <> auth.uid() then raise exception '본인 메시지만 지울 수 있습니다.'; end if;
    if now() - msg.created_at > make_interval(mins => mins) then raise exception '보낸 뒤 %분이 지나 지울 수 없습니다. 고치기는 됩니다.', mins; end if;
  end if;
  delete from public.chat_hidden where message_id = p_id;
  delete from public.site_docs where message_id = p_id;
  update public.chat_messages set deleted = true, text = '', attachments = '[]', hidden_by = null, hidden_at = null where id = p_id;
end $$;

create or replace function public.hide_message(p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = public as $$
declare msg public.chat_messages; h public.chat_hidden;
begin
  if not public.is_admin() then raise exception '관리자만 가릴 수 있습니다.'; end if;
  select * into msg from public.chat_messages where id = p_id;
  if not found or msg.deleted then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if p_hidden then
    if msg.hidden_at is not null then return; end if;
    insert into public.chat_hidden (message_id, text, attachments) values (p_id, msg.text, msg.attachments);
    update public.chat_messages set text = '', attachments = '[]', hidden_by = auth.uid(), hidden_at = now() where id = p_id;
  else
    select * into h from public.chat_hidden where message_id = p_id;
    if not found then return; end if;
    update public.chat_messages set text = h.text, attachments = h.attachments, hidden_by = null, hidden_at = null where id = p_id;
    delete from public.chat_hidden where message_id = p_id;
  end if;
end $$;

create or replace function public.mark_room_read(p_room uuid) returns void
language sql security definer set search_path = public as $$
  update public.chat_room_members set last_read_at = now() where room_id = p_room and member_id = auth.uid()
$$;

create or replace function public.set_room_muted(p_room uuid, p_muted boolean) returns void
language sql security definer set search_path = public as $$
  update public.chat_room_members set muted = p_muted where room_id = p_room and member_id = auth.uid()
$$;

create or replace function public.pin_room(p_room uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_room_member(p_room) then raise exception '이 방에 들어가 있지 않습니다.'; end if;
  update public.chat_rooms set pinned = btrim(coalesce(p_text, '')),
    pinned_by = case when btrim(coalesce(p_text, '')) = '' then null else auth.uid() end,
    pinned_at = case when btrim(coalesce(p_text, '')) = '' then null else now() end
  where id = p_room;
end $$;

create or replace function public.open_dm(p_other uuid) returns public.chat_rooms
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  if not public.is_member() then raise exception '로그인이 필요합니다.'; end if;
  if p_other = auth.uid() then raise exception '본인과는 대화할 수 없습니다.'; end if;
  if not exists (select 1 from public.members where id = p_other and active) then raise exception '대화 상대를 찾을 수 없습니다.'; end if;
  select c.* into r from public.chat_rooms c
    where c.kind = 'dm'
      and exists (select 1 from public.chat_room_members where room_id = c.id and member_id = auth.uid())
      and exists (select 1 from public.chat_room_members where room_id = c.id and member_id = p_other)
    limit 1;
  if not found then
    insert into public.chat_rooms (kind, name) values ('dm', '') returning * into r;
    insert into public.chat_room_members (room_id, member_id) values (r.id, auth.uid()), (r.id, p_other);
  end if;
  return r;
end $$;

-- 대표님: 채팅 메시지를 이번 주 지시사항에 한 줄로 덧붙인다
create or replace function public.message_to_directive(p_message uuid, p_text text, p_members uuid[], p_site uuid, p_week date) returns void
language plpgsql security definer set search_path = public as $$
declare
  msg public.chat_messages;
  line text := btrim(coalesce(p_text, ''));
  m uuid;
  who text;
begin
  if not public.is_ceo() then raise exception '지시 등록은 대표님만 할 수 있습니다.'; end if;
  select * into msg from public.chat_messages where id = p_message;
  if not found or not public.is_room_member(msg.room_id) then raise exception '메시지를 찾을 수 없습니다.'; end if;
  if line = '' then raise exception '지시 내용을 입력하세요.'; end if;
  if coalesce(array_length(p_members, 1), 0) = 0 and p_site is null then raise exception '지시를 받을 사람이나 현장을 고르세요.'; end if;
  insert into public.weeks (id) values (p_week) on conflict do nothing;
  foreach m in array coalesce(p_members, '{}') loop
    insert into public.directives (week_id, target_kind, site_id, member_id, slot, content)
    values (p_week, 'member', null, m, null, '- ' || line)
    on conflict (week_id, target_kind, site_id, member_id, slot) do update
      set content = case when btrim(directives.content) = '' then excluded.content else rtrim(directives.content) || E'\n' || excluded.content end,
          updated_at = now(), status = 'open', status_by = null, status_at = null;
  end loop;
  if p_site is not null then
    insert into public.directives (week_id, target_kind, site_id, member_id, slot, content)
    values (p_week, 'site', p_site, null, null, '- ' || line)
    on conflict (week_id, target_kind, site_id, member_id, slot) do update
      set content = case when btrim(directives.content) = '' then excluded.content else rtrim(directives.content) || E'\n' || excluded.content end,
          updated_at = now(), status = 'open', status_by = null, status_at = null;
  end if;
  update public.chat_messages set directive = jsonb_build_object('memberIds', to_jsonb(coalesce(p_members, '{}')), 'siteId', p_site, 'by', auth.uid(), 'at', now())
  where id = p_message;
  select string_agg(x, ', ') into who from (
    select name as x from public.members where id = any (coalesce(p_members, '{}'))
    union all select name from public.sites where id = p_site) t;
  perform public.post_system(msg.room_id, '지시사항으로 등록했습니다 → ' || coalesce(who, ''), p_message, coalesce(p_members, '{}'));
end $$;

-- ───────────── 공지 ─────────────
create or replace function public.save_notice(p_id uuid, p_title text, p_body text, p_require_ack boolean, p_pinned boolean) returns public.notices
language plpgsql security definer set search_path = public as $$
declare n public.notices;
begin
  if not public.can_write_notice() then raise exception '전체 공지는 대표님만 쓸 수 있습니다.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '제목을 입력하세요.'; end if;
  if p_id is null then
    insert into public.notices (title, body, author_id, require_ack, pinned)
    values (btrim(p_title), btrim(coalesce(p_body, '')), auth.uid(), p_require_ack, p_pinned) returning * into n;
    insert into public.notice_reads (notice_id, member_id, read_at, ack_at) values (n.id, auth.uid(), now(), now());
  else
    update public.notices set title = btrim(p_title), body = btrim(coalesce(p_body, '')), require_ack = p_require_ack, pinned = p_pinned, updated_at = now()
    where id = p_id returning * into n;
    if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  end if;
  return n;
end $$;

create or replace function public.delete_notice(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write_notice() then raise exception '공지는 대표님만 지울 수 있습니다.'; end if;
  delete from public.notices where id = p_id;
end $$;

create or replace function public.notice_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notice_reads (notice_id, member_id, read_at) values (p_id, auth.uid(), now())
  on conflict (notice_id, member_id) do update set read_at = coalesce(notice_reads.read_at, now())
$$;

create or replace function public.notice_ack(p_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notice_reads (notice_id, member_id, read_at, ack_at) values (p_id, auth.uid(), now(), now())
  on conflict (notice_id, member_id) do update set read_at = coalesce(notice_reads.read_at, now()), ack_at = coalesce(notice_reads.ack_at, now())
$$;

create or replace function public.notice_remind(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n public.notices; cnt int;
begin
  if not (public.is_ceo() or public.is_admin()) then raise exception '대표님과 관리자만 다시 알릴 수 있습니다.'; end if;
  select * into n from public.notices where id = p_id;
  if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  select count(*) into cnt from public.members m
    where m.active and not exists (select 1 from public.notice_reads r where r.notice_id = p_id and r.member_id = m.id
                                   and (case when n.require_ack then r.ack_at else r.read_at end) is not null);
  perform public.call_notify(jsonb_build_object('action', 'notice-remind', 'noticeId', p_id));
  return cnt;
end $$;

-- ───────────── 신규 교회건축 문의 ─────────────
create or replace function public.stage_label(s text) returns text
language sql immutable as $$
  select case s when 'new' then '접수' when 'consult' then '상담' when 'visit' then '현장 답사' when 'proposal' then '견적·제안'
    when 'won' then '계약' when 'closed' then '상담 완료' when 'hold' then '보류' when 'lost' then '무산' else s end
$$;

create or replace function public.save_inquiry(p jsonb) returns public.inquiries
language plpgsql security definer set search_path = public as $$
declare
  old public.inquiries;
  q public.inquiries;
  room uuid := (select id from public.chat_rooms where kind = 'inquiry' limit 1);
  owner uuid := public.try_uuid(nullif(p->>'ownerId', ''));
begin
  if not public.in_inquiry_room() then raise exception '문의방 인원만 문의를 관리할 수 있습니다.'; end if;
  if btrim(coalesce(p->>'church', '')) = '' then raise exception '교회 이름을 입력하세요.'; end if;
  select * into old from public.inquiries where id = public.try_uuid(p->>'id');
  if found then
    update public.inquiries set church = btrim(p->>'church'), region = coalesce(p->>'region', ''), contact_name = coalesce(p->>'contactName', ''),
      phone = coalesce(p->>'phone', ''), scale = coalesce(p->>'scale', ''), budget = coalesce(p->>'budget', ''), timing = coalesce(p->>'timing', ''),
      source = coalesce(p->>'source', ''), stage = coalesce(p->>'stage', old.stage), owner_id = owner, note = coalesce(p->>'note', ''),
      updated_at = now(), last_activity_at = now()
    where id = old.id returning * into q;
    if room is not null and old.stage <> q.stage then
      perform public.post_system(room, '단계 변경: ' || public.stage_label(old.stage) || ' → ' || public.stage_label(q.stage), null, '{}', q.id);
    end if;
    if room is not null and q.owner_id is not null and q.owner_id is distinct from old.owner_id then
      perform public.post_system(room, '담당자 지정: ' || (select name from public.members where id = q.owner_id), null, array[q.owner_id], q.id);
    end if;
  else
    insert into public.inquiries (church, region, contact_name, phone, scale, budget, timing, source, stage, owner_id, note, created_by)
    values (btrim(p->>'church'), coalesce(p->>'region', ''), coalesce(p->>'contactName', ''), coalesce(p->>'phone', ''), coalesce(p->>'scale', ''),
            coalesce(p->>'budget', ''), coalesce(p->>'timing', ''), coalesce(p->>'source', ''), coalesce(p->>'stage', 'new'), owner, coalesce(p->>'note', ''), auth.uid())
    returning * into q;
    if room is not null then
      perform public.post_system(room, '새 문의 등록: ' || q.church || ' (' || coalesce(nullif(q.region, ''), '지역 미정') || ')', null,
        case when q.owner_id is null then '{}'::uuid[] else array[q.owner_id] end, q.id);
    end if;
  end if;
  return q;
end $$;

create or replace function public.delete_inquiry(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_ceo() or public.is_admin()) then raise exception '문의 삭제는 대표님과 관리자만 할 수 있습니다.'; end if;
  delete from public.inquiries where id = p_id;
end $$;

create or replace function public.inquiry_to_site(p_id uuid) returns public.sites
language plpgsql security definer set search_path = public as $$
declare q public.inquiries; s public.sites; st text; room uuid := (select id from public.chat_rooms where kind = 'inquiry' limit 1);
begin
  if not (public.is_ceo() or public.is_admin()) then raise exception '현장 등록은 대표님과 관리자만 할 수 있습니다.'; end if;
  select * into q from public.inquiries where id = p_id;
  if not found then raise exception '문의를 찾을 수 없습니다.'; end if;
  if q.site_id is not null then raise exception '이미 현장으로 넘긴 문의입니다.'; end if;
  select id into st from public.stages where id = 'sales' or label like '%영업%' order by (id = 'sales') desc, sort desc limit 1;
  if st is null then select id into st from public.stages order by sort desc limit 1; end if;
  insert into public.sites (name, note, stage, due_text, process, scale, sort)
  values (q.church, concat_ws(' · ', nullif(q.region, ''), nullif(q.contact_name, '')), st, q.timing, '영업', q.scale,
          (select coalesce(max(sort), 0) + 1 from public.sites))
  returning * into s;
  update public.inquiries set site_id = s.id, stage = 'won', updated_at = now(), last_activity_at = now() where id = p_id;
  if room is not null then perform public.post_system(room, '영업 현장으로 등록했습니다: ' || s.name, null, '{}', p_id); end if;
  return s;
end $$;

-- ───────────── 현장 자료 ─────────────
create or replace function public.add_site_doc(p_site uuid, p_category text, p_date date, p_title text, p_note text,
  p_file_name text, p_file_type text, p_path text, p_size bigint, p_text text) returns public.site_docs
language plpgsql security definer set search_path = public as $$
declare d public.site_docs; r uuid;
begin
  if not public.can_see_site_docs(p_site) then raise exception '이 현장방 인원만 자료를 올릴 수 있습니다.'; end if;
  insert into public.site_docs (site_id, category, doc_date, title, note, file_name, file_type, storage_path, size, text, uploaded_by)
  values (p_site, p_category, p_date, coalesce(nullif(btrim(p_title), ''), p_category), btrim(coalesce(p_note, '')), p_file_name, p_file_type, p_path, p_size, coalesce(p_text, ''), auth.uid())
  returning * into d;
  for r in select id from public.chat_rooms where kind = 'site' and site_id = p_site and public.is_room_member(id) loop
    perform public.post_system(r, p_category || '를 올렸습니다: ' || d.title || ' (' || to_char(p_date, 'MM/DD') || ')');
  end loop;
  return d;
end $$;

create or replace function public.delete_site_doc(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d public.site_docs;
begin
  select * into d from public.site_docs where id = p_id;
  if not found then return null; end if;
  if d.uploaded_by is distinct from auth.uid() and not (public.is_ceo() or public.is_admin()) then raise exception '올린 사람과 관리자만 지울 수 있습니다.'; end if;
  delete from public.site_docs where id = p_id;
  -- 채팅 첨부로 올린 파일은 대화에 남아 있으므로 파일은 지우지 않는다
  return case when d.message_id is null then d.storage_path end;
end $$;

create or replace function public.request_minutes(p_site uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  select id into r from public.chat_rooms where kind = 'site' and site_id = p_site and public.is_room_member(id) limit 1;
  if r is null then raise exception '이 현장방 인원만 요청할 수 있습니다.'; end if;
  perform public.post_system(r, '이번 주 정기회의 회의록이 아직 없습니다. 회의 후 회의록(PDF 또는 사진)을 [자료] 칸에 올려 주세요.', null,
    (select coalesce(array_agg(member_id), '{}') from public.chat_room_members where room_id = r and member_id <> auth.uid()));
end $$;

-- ───────────── 안전 당부 보내기 (대표님) ─────────────
create or replace function public.send_safety(p_rooms uuid[], p_text text, p_tip text) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  if not public.is_ceo() then raise exception '대표님만 보낼 수 있습니다.'; end if;
  if btrim(coalesce(p_text, '')) = '' then raise exception '보낼 내용을 입력하세요.'; end if;
  if coalesce(array_length(p_rooms, 1), 0) = 0 then raise exception '보낼 방을 고르세요.'; end if;
  foreach r in array p_rooms loop
    if not public.is_room_member(r) then raise exception '들어가 있지 않은 방이 있습니다.'; end if;
    insert into public.chat_messages (room_id, author_id, text, safety) values (r, auth.uid(), btrim(p_text), true);
  end loop;
  update public.safety_tips set status = 'sent', text = btrim(p_text), updated_at = now() where id = p_tip;
end $$;

-- ───────────── 관리자: 방 만들기·고치기·지우기 ─────────────
create or replace function public.admin_save_room(p_id uuid, p_name text, p_site uuid, p_meeting_dow int, p_members uuid[]) returns public.chat_rooms
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms; builtin boolean;
begin
  if not public.is_admin() then raise exception '관리자만 방을 관리할 수 있습니다.'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception '방 이름을 입력하세요.'; end if;
  if p_id is null then
    insert into public.chat_rooms (kind, name, site_id, meeting_dow)
    values (case when p_site is null then 'group' else 'site' end, btrim(p_name), p_site, case when p_site is null then null else p_meeting_dow end)
    returning * into r;
  else
    select * into r from public.chat_rooms where id = p_id;
    if not found or r.kind = 'dm' then raise exception '방을 찾을 수 없습니다.'; end if;
    builtin := r.kind in ('inquiry', 'safety');
    update public.chat_rooms set name = btrim(p_name),
      kind = case when builtin then kind when p_site is null then 'group' else 'site' end,
      site_id = case when builtin then null else p_site end,
      meeting_dow = case when builtin or p_site is null then null else p_meeting_dow end
    where id = p_id returning * into r;
  end if;
  delete from public.chat_room_members where room_id = r.id and not (member_id = any (coalesce(p_members, '{}')));
  insert into public.chat_room_members (room_id, member_id)
  select r.id, m from unnest(coalesce(p_members, '{}')) m join public.members x on x.id = m
  on conflict do nothing;
  return r;
end $$;

create or replace function public.admin_delete_room(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  if not public.is_admin() then raise exception '관리자만 방을 지울 수 있습니다.'; end if;
  select * into r from public.chat_rooms where id = p_id;
  if not found or r.kind = 'dm' then raise exception '방을 찾을 수 없습니다.'; end if;
  if r.kind in ('inquiry', 'safety') then raise exception '문의방·안전방은 기본 방이라 지울 수 없습니다. 인원만 바꿀 수 있습니다.'; end if;
  delete from public.chat_rooms where id = p_id;
end $$;

-- 퇴사(비활성) 처리하면 방에서 뺀다 (1:1 기록은 남김)
create or replace function public.leave_rooms_on_deactivate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active then
    delete from public.chat_room_members m using public.chat_rooms r
      where m.room_id = r.id and r.kind <> 'dm' and m.member_id = new.id;
  end if;
  return new;
end $$;
create trigger members_leave_rooms after update of active on public.members
  for each row execute function public.leave_rooms_on_deactivate();

-- ───────────── 기본 방 ─────────────
insert into public.chat_rooms (kind, name, sort) values ('inquiry', '신규 교회건축 문의', 20), ('safety', '안전방', 10)
on conflict do nothing;
insert into public.chat_room_members (room_id, member_id)
select r.id, m.id from public.chat_rooms r, public.members m
where r.kind in ('inquiry', 'safety') and m.active and (m.is_ceo or m.is_admin)
on conflict do nothing;

-- ───────────── 알림 ─────────────
create or replace function public.notify_chat_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- 단계 변경 같은 안내는 부른 사람이 있을 때만 알린다
  if not new.system or coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform public.call_notify(jsonb_build_object('action', 'chat', 'messageId', new.id));
  end if;
  return new;
end $$;
create trigger chat_messages_notify after insert on public.chat_messages
  for each row execute function public.notify_chat_message();

create or replace function public.notify_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_notify(jsonb_build_object('action', 'notice', 'noticeId', new.id));
  return new;
end $$;
create trigger notices_notify after insert on public.notices
  for each row execute function public.notify_notice();

-- 매일 오전 9시(한국): 7일 넘게 진행 없는 문의를 담당자에게
do $$
begin
  perform cron.unschedule('inquiry-stale') where exists (select 1 from cron.job where jobname = 'inquiry-stale');
  perform cron.schedule('inquiry-stale', '0 0 * * *', 'select public.call_notify(''{"action":"inquiry-stale"}''::jsonb)');
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- ───────────── 백업에 소통 기록 포함 (채팅은 최근 90일) ─────────────
create or replace function public.make_backup(p_kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  doc jsonb;
  new_id bigint;
begin
  doc := jsonb_build_object(
    'version', 4,
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
      'app_settings', (select coalesce(jsonb_agg(t), '[]') from public.app_settings t),
      'notices', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.notices t),
      'notice_reads', (select coalesce(jsonb_agg(t), '[]') from public.notice_reads t),
      'inquiries', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.inquiries t),
      'site_docs', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.site_docs t),
      'chat_rooms', (select coalesce(jsonb_agg(t), '[]') from public.chat_rooms t),
      'chat_room_members', (select coalesce(jsonb_agg(t), '[]') from public.chat_room_members t),
      'chat_messages', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.chat_messages t where t.created_at > now() - interval '90 days')
    )
  );
  insert into public.backups (kind, created_by, size_bytes, data)
  values (p_kind, auth.uid(), octet_length(doc::text), doc) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by created_at desc limit 12);
  return new_id;
end $$;
revoke all on function public.make_backup(text) from public, anon, authenticated;

-- ───────────── 실행 권한·실시간 ─────────────
revoke all on function public.talk_setting(text), public.talk_rooms(), public.send_message(uuid, text, jsonb, uuid, uuid, text, jsonb),
  public.edit_message(uuid, text), public.delete_message(uuid), public.hide_message(uuid, boolean), public.mark_room_read(uuid),
  public.set_room_muted(uuid, boolean), public.pin_room(uuid, text), public.open_dm(uuid), public.message_to_directive(uuid, text, uuid[], uuid, date),
  public.save_notice(uuid, text, text, boolean, boolean), public.delete_notice(uuid), public.notice_read(uuid), public.notice_ack(uuid), public.notice_remind(uuid),
  public.save_inquiry(jsonb), public.delete_inquiry(uuid), public.inquiry_to_site(uuid),
  public.add_site_doc(uuid, text, date, text, text, text, text, text, bigint, text), public.delete_site_doc(uuid), public.request_minutes(uuid),
  public.admin_save_room(uuid, text, uuid, int, uuid[]), public.admin_delete_room(uuid), public.send_safety(uuid[], text, text)
  from public, anon;
grant execute on function public.talk_setting(text), public.talk_rooms(), public.send_message(uuid, text, jsonb, uuid, uuid, text, jsonb),
  public.edit_message(uuid, text), public.delete_message(uuid), public.hide_message(uuid, boolean), public.mark_room_read(uuid),
  public.set_room_muted(uuid, boolean), public.pin_room(uuid, text), public.open_dm(uuid), public.message_to_directive(uuid, text, uuid[], uuid, date),
  public.save_notice(uuid, text, text, boolean, boolean), public.delete_notice(uuid), public.notice_read(uuid), public.notice_ack(uuid), public.notice_remind(uuid),
  public.save_inquiry(jsonb), public.delete_inquiry(uuid), public.inquiry_to_site(uuid),
  public.add_site_doc(uuid, text, date, text, text, text, text, text, bigint, text), public.delete_site_doc(uuid), public.request_minutes(uuid),
  public.admin_save_room(uuid, text, uuid, int, uuid[]), public.admin_delete_room(uuid), public.send_safety(uuid[], text, text)
  to authenticated;

alter publication supabase_realtime add table public.chat_rooms, public.chat_room_members, public.chat_messages, public.notices, public.notice_reads,
  public.inquiries, public.site_docs;
