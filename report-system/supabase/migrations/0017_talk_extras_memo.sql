-- 소통 추가 기능 + 내 메모
--  · 긴급 공지: 쉬는 시간과 상관없이 전원에게, 10분 안에 확인 안 한 사람에게 한 번 더
--  · 방 고정(사람마다), 방에 안내 한 줄 남기기(일정 등록 알림 등)
--  · 유튜브 새 영상 공지 (관리자)
--  · 내 메모: 본인만 읽고 쓴다. 관리자 백업에도 넣지 않는다. 할 일 알림 예약

-- ───────────── 긴급 공지 ─────────────
alter table public.notices add column if not exists urgent boolean not null default false;
alter table public.notices add column if not exists urgent_reminded_at timestamptz;

drop function if exists public.save_notice(uuid, text, text, boolean, boolean);
create or replace function public.save_notice(p_id uuid, p_title text, p_body text, p_require_ack boolean, p_pinned boolean, p_urgent boolean default false)
returns public.notices
language plpgsql security definer set search_path = public as $$
declare n public.notices;
begin
  if not public.can_write_notice() then raise exception '전체 공지는 대표님만 쓸 수 있습니다.'; end if;
  if btrim(coalesce(p_title, '')) = '' then raise exception '제목을 입력하세요.'; end if;
  if p_id is null then
    insert into public.notices (title, body, author_id, require_ack, pinned, urgent)
    values (btrim(p_title), btrim(coalesce(p_body, '')), auth.uid(), p_require_ack or p_urgent, p_pinned or p_urgent, coalesce(p_urgent, false)) returning * into n;
    insert into public.notice_reads (notice_id, member_id, read_at, ack_at) values (n.id, auth.uid(), now(), now());
  else
    update public.notices set title = btrim(p_title), body = btrim(coalesce(p_body, '')), require_ack = p_require_ack or p_urgent,
      pinned = p_pinned or p_urgent, urgent = coalesce(p_urgent, false), updated_at = now()
    where id = p_id returning * into n;
    if not found then raise exception '공지를 찾을 수 없습니다.'; end if;
  end if;
  return n;
end $$;

-- 유튜브 새 영상 알리기: 관리자(와 대표님)
create or replace function public.announce_video(p_title text, p_video_id text) returns public.notices
language plpgsql security definer set search_path = public as $$
declare n public.notices;
begin
  if not (public.is_admin() or public.is_ceo()) then raise exception '관리자만 알릴 수 있습니다.'; end if;
  if p_video_id !~ '^[A-Za-z0-9_-]{6,20}$' then raise exception '영상 주소가 맞지 않습니다.'; end if;
  insert into public.notices (title, body, author_id)
  values ('[사닥다리 유튜브] ' || left(btrim(coalesce(p_title, '새 영상')), 120),
          E'새 영상이 올라왔습니다.\nhttps://www.youtube.com/watch?v=' || p_video_id || E'\n\n사닥다리 유튜브 메뉴에서도 볼 수 있습니다.', auth.uid())
  returning * into n;
  insert into public.notice_reads (notice_id, member_id, read_at) values (n.id, auth.uid(), now());
  return n;
end $$;

-- ───────────── 방 고정 · 방 안내 ─────────────
alter table public.chat_room_members add column if not exists starred boolean not null default false;

create or replace function public.set_room_starred(p_room uuid, p_starred boolean) returns void
language sql security definer set search_path = public as $$
  update public.chat_room_members set starred = p_starred where room_id = p_room and member_id = auth.uid()
$$;

create or replace function public.post_note(p_room uuid, p_text text, p_reply uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_room_member(p_room) then raise exception '이 방에 들어가 있지 않습니다.'; end if;
  if btrim(coalesce(p_text, '')) = '' then return; end if;
  perform public.post_system(p_room, left(btrim(p_text), 500), p_reply);
end $$;

create or replace function public.talk_rooms() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'lastAt' desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'room', to_jsonb(r),
      'memberIds', (select coalesce(jsonb_agg(m.member_id), '[]') from public.chat_room_members m where m.room_id = r.id),
      'mutedBy', (select coalesce(jsonb_agg(m.member_id), '[]') from public.chat_room_members m where m.room_id = r.id and m.muted),
      'reads', (select coalesce(jsonb_object_agg(m.member_id, m.last_read_at), '{}') from public.chat_room_members m where m.room_id = r.id),
      'starred', me.starred,
      'last', (select to_jsonb(c) from public.chat_messages c where c.room_id = r.id order by c.created_at desc limit 1),
      'lastAt', (select max(c.created_at) from public.chat_messages c where c.room_id = r.id),
      'unread', (select count(*) from public.chat_messages c where c.room_id = r.id and c.author_id <> auth.uid() and c.created_at > me.last_read_at)
    ) as x
    from public.chat_rooms r
    join public.chat_room_members me on me.room_id = r.id and me.member_id = auth.uid()
  ) t
$$;

-- ───────────── 내 메모 ─────────────
create table public.member_memos (
  member_id uuid primary key references public.members (id) on delete cascade,
  text text not null default '',
  todos jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.member_memos enable row level security;
-- 본인만. 대표·관리자 예외 없음
create policy "own" on public.member_memos for select to authenticated using (member_id = auth.uid());

-- 할 일 알림 예약 (서버 예약 작업이 보낸다. 화면에서는 직접 읽지 않음)
create table public.memo_reminders (
  member_id uuid not null references public.members (id) on delete cascade,
  todo_id text not null,
  text text not null,
  remind_at timestamptz not null,
  sent_at timestamptz,
  primary key (member_id, todo_id, remind_at)
);
create index memo_reminders_due_idx on public.memo_reminders (remind_at) where sent_at is null;
alter table public.memo_reminders enable row level security;

create or replace function public.save_memo(p_text text, p_todos jsonb) returns public.member_memos
language plpgsql security definer set search_path = public as $$
declare m public.member_memos; t jsonb; at timestamptz;
begin
  if not public.is_member() then raise exception '로그인이 필요합니다.'; end if;
  if length(coalesce(p_text, '')) > 20000 or jsonb_array_length(coalesce(p_todos, '[]')) > 300 then raise exception '메모가 너무 깁니다.'; end if;
  insert into public.member_memos (member_id, text, todos, updated_at) values (auth.uid(), coalesce(p_text, ''), coalesce(p_todos, '[]'), now())
  on conflict (member_id) do update set text = excluded.text, todos = excluded.todos, updated_at = now()
  returning * into m;
  -- 아직 안 보낸 알림은 지금 메모 기준으로 다시 만든다 (보낸 알림 기록은 남겨 같은 알림을 두 번 보내지 않는다)
  delete from public.memo_reminders where member_id = auth.uid() and sent_at is null;
  for t in select * from jsonb_array_elements(coalesce(p_todos, '[]')) loop
    continue when coalesce((t->>'done')::boolean, false) or coalesce(t->>'remindAt', '') = '';
    begin
      at := (t->>'remindAt')::timestamp at time zone 'Asia/Seoul';
    exception when others then continue;
    end;
    continue when at <= now();
    insert into public.memo_reminders (member_id, todo_id, text, remind_at)
    values (auth.uid(), coalesce(t->>'id', md5(t::text)), left(coalesce(t->>'text', ''), 200), at)
    on conflict do nothing;
  end loop;
  return m;
end $$;

-- 5분마다: 때가 된 메모 알림, 10분 지난 긴급 공지 미확인자 → 보낼 것이 있을 때만 알림 서버를 부른다
do $$
begin
  perform cron.unschedule('timed-notify') where exists (select 1 from cron.job where jobname = 'timed-notify');
  perform cron.schedule('timed-notify', '*/5 * * * *', $job$
    select public.call_notify('{"action":"timed"}'::jsonb)
    where exists (select 1 from public.memo_reminders where sent_at is null and remind_at <= now())
       or exists (select 1 from public.notices where urgent and urgent_reminded_at is null and created_at <= now() - interval '10 minutes' and created_at > now() - interval '1 day')
  $job$);
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

-- ───────────── 실행 권한 ─────────────
revoke all on function public.save_notice(uuid, text, text, boolean, boolean, boolean), public.announce_video(text, text), public.set_room_starred(uuid, boolean),
  public.post_note(uuid, text, uuid), public.save_memo(text, jsonb) from public, anon;
grant execute on function public.save_notice(uuid, text, text, boolean, boolean, boolean), public.announce_video(text, text), public.set_room_starred(uuid, boolean),
  public.post_note(uuid, text, uuid), public.save_memo(text, jsonb), public.talk_rooms() to authenticated;
