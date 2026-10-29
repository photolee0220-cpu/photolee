-- 지난 주차 잠금, 수정 기록, 지시 처리 상태, 자동 백업, 푸시 알림, 현장 기간 요약

-- ───────────── 지난 주차 잠금 ─────────────
-- 이번 보고일 (한국 시간): 월요일이면 오늘, 아니면 다가오는 월요일. 화면의 currentWeekId와 같은 규칙
create or replace function public.current_week() returns date
language sql stable as $$
  select (d + ((8 - extract(isodow from d)::int) % 7))::date
  from (select (now() at time zone 'Asia/Seoul')::date as d) x
$$;

-- 직원은 지난 주차 보고·사진·첨부를 바꿀 수 없다 (보기는 그대로). 관리자와 서버 작업은 예외
create or replace function public.guard_past_week() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  w date := case when tg_op = 'DELETE' then old.week_id else new.week_id end;
begin
  if auth.uid() is not null and not public.is_admin() and w < public.current_week() then
    raise exception '지난 주차 보고는 관리자만 수정할 수 있습니다.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger entries_past_week before insert or update or delete on public.entries
  for each row execute function public.guard_past_week();
create trigger photos_past_week before insert or delete on public.photos
  for each row execute function public.guard_past_week();
create trigger attachments_past_week before insert or delete on public.attachments
  for each row execute function public.guard_past_week();

-- ───────────── 수정 기록 ─────────────
create table public.entry_history (
  id bigserial primary key,
  entry_id uuid not null references public.entries (id) on delete cascade,
  week_id date not null,
  department_id uuid not null,
  content text not null,
  edited_by uuid references public.members (id),
  edited_at timestamptz not null,
  replaced_by uuid references public.members (id),
  replaced_at timestamptz not null default now()
);
create index entry_history_entry_idx on public.entry_history (entry_id, edited_at desc);
alter table public.entry_history enable row level security;
create policy "read" on public.entry_history for select to authenticated using (public.can_view_dept(department_id));

-- 자동 저장이 몇 초마다 일어나므로 같은 사람이 10분 안에 이어서 고친 것은 한 번으로 친다
create or replace function public.keep_entry_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.content is distinct from new.content and btrim(old.content) <> ''
     and (old.updated_by is distinct from new.updated_by or old.updated_at < now() - interval '10 minutes') then
    insert into public.entry_history (entry_id, week_id, department_id, content, edited_by, edited_at, replaced_by)
    values (old.id, old.week_id, old.department_id, old.content, old.updated_by, old.updated_at, new.updated_by);
  end if;
  return new;
end $$;
create trigger entries_history after update on public.entries
  for each row execute function public.keep_entry_history();

-- ───────────── 대표 지시 처리 상태 ─────────────
alter table public.directives
  add column status text not null default 'open' check (status in ('open', 'doing', 'done')),
  add column status_by uuid references public.members (id),
  add column status_at timestamptz;

-- 담당자(개인 지시는 본인, 현장 지시는 현장 칸을 쓰는 부서원)와 대표·관리자가 바꾼다. 지난 주차도 가능
create or replace function public.set_directive_status(p_directive uuid, p_status text)
returns public.directives
language plpgsql security definer set search_path = public as $$
declare d public.directives;
begin
  if p_status not in ('open', 'doing', 'done') then raise exception '상태 값이 맞지 않습니다.'; end if;
  select * into d from public.directives where id = p_directive;
  if not found then raise exception '지시사항을 찾을 수 없습니다.'; end if;
  if not (public.is_ceo() or public.is_admin()
          or (d.target_kind = 'member' and d.member_id = auth.uid())
          or (d.target_kind = 'site' and exists (select 1 from public.departments x where x.id = public.my_department() and x.writes_sites))) then
    raise exception '이 지시사항의 처리 상태를 바꿀 권한이 없습니다.';
  end if;
  update public.directives set status = p_status, status_by = auth.uid(), status_at = now() where id = p_directive returning * into d;
  return d;
end $$;
grant execute on function public.set_directive_status(uuid, text) to authenticated;

-- ───────────── 자동 백업 (관리자만 보고 내려받음) ─────────────
create table public.backups (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('auto', 'manual')),
  created_by uuid references public.members (id),
  size_bytes int not null default 0,
  data jsonb not null
);
alter table public.backups enable row level security;
create policy "admin read" on public.backups for select to authenticated using (public.is_admin());

-- 보고 글·지시·피드백·현장·인원 정보를 통째로 담는다 (사진·첨부 파일 자체는 저장 공간에 그대로 있다). 최근 12개만 남긴다
create or replace function public.make_backup(p_kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  doc jsonb;
  new_id bigint;
begin
  doc := jsonb_build_object(
    'version', 1,
    'created_at', now(),
    'tables', jsonb_build_object(
      'departments', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.departments t),
      'members', (select coalesce(jsonb_agg(t order by t.name), '[]') from public.members t),
      'dept_view_grants', (select coalesce(jsonb_agg(t), '[]') from public.dept_view_grants t),
      'stages', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.stages t),
      'sites', (select coalesce(jsonb_agg(t order by t.sort), '[]') from public.sites t),
      'weeks', (select coalesce(jsonb_agg(t order by t.id), '[]') from public.weeks t),
      'entries', (select coalesce(jsonb_agg(t order by t.week_id), '[]') from public.entries t),
      'directives', (select coalesce(jsonb_agg(t order by t.week_id), '[]') from public.directives t),
      'comments', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.comments t),
      'photos', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.photos t),
      'attachments', (select coalesce(jsonb_agg(t order by t.created_at), '[]') from public.attachments t),
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

create or replace function public.create_backup() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 백업할 수 있습니다.'; end if;
  return public.make_backup('manual');
end $$;
grant execute on function public.create_backup() to authenticated;

-- ───────────── 푸시 알림 ─────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null default auth.uid() references public.members (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "own read" on public.push_subscriptions for select to authenticated using (member_id = auth.uid() or public.is_admin());
create policy "own insert" on public.push_subscriptions for insert to authenticated with check (member_id = auth.uid());
create policy "own delete" on public.push_subscriptions for delete to authenticated using (member_id = auth.uid());

-- 서버 전용 값 (알림 서명 키, 예약 작업 비밀값, 함수 주소). 화면에서는 읽을 수 없다
create table public.app_secrets (
  key text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (key, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create table public.push_log (
  id bigserial primary key,
  kind text not null,
  sent int not null default 0,
  failed int not null default 0,
  detail text not null default '',
  created_at timestamptz not null default now()
);
alter table public.push_log enable row level security;
create policy "admin read" on public.push_log for select to authenticated using (public.is_admin());

-- notify 함수 호출 (pg_net). 설정 전이거나 확장이 없으면 조용히 넘어간다
create or replace function public.call_notify(body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  fn_url text := (select value from public.app_secrets where key = 'functions_url');
  anon text := (select value from public.app_secrets where key = 'anon_key');
  secret text := (select value from public.app_secrets where key = 'cron_secret');
begin
  if fn_url is null or anon is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using fn_url || '/notify', body || jsonb_build_object('secret', secret),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon);
exception when others then
  raise notice 'call_notify skipped: %', sqlerrm;
end $$;
revoke all on function public.call_notify(jsonb) from public, anon, authenticated;

-- 대표님이 피드백을 남기면 담당자에게 알림
create or replace function public.notify_ceo_comment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.members m where m.id = new.author_id and m.is_ceo) then
    perform public.call_notify(jsonb_build_object('action', 'feedback', 'commentId', new.id));
  end if;
  return new;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_ceo_comment();

-- ───────────── 현장 기간 요약 (AI) ─────────────
create table public.site_summaries (
  site_id uuid primary key references public.sites (id) on delete cascade,
  months int not null,
  overview text not null,
  milestones jsonb not null default '[]',
  issues jsonb not null default '[]',
  model text not null default '',
  generated_at timestamptz not null default now(),
  generated_by uuid references public.members (id)
);
alter table public.site_summaries enable row level security;
create policy "ceo admin read" on public.site_summaries for select to authenticated using (public.is_ceo() or public.is_admin());

-- 현장 삭제 때 요약도 함께 지워지도록 (외래키 on delete cascade). delete_site는 그대로 동작한다

-- ───────────── 예약 작업 (pg_cron) ─────────────
-- 확장을 켤 수 없는 환경이면 건너뛴다 (예약 없이도 나머지 기능은 동작)
do $$ begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then raise notice 'pg_cron unavailable: %', sqlerrm;
end $$;
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net unavailable: %', sqlerrm;
end $$;
do $$ begin
  -- 매주 월요일 오전 8시(한국) 백업 = 일요일 23:00 UTC
  perform cron.schedule('weekly-backup', '0 23 * * 0', 'select public.make_backup(''auto'')');
  -- 금요일 오후 3시, 토요일 오전 8시 30분(한국) 미작성자 알림
  perform cron.schedule('deadline-reminder-fri', '0 6 * * 5', 'select public.call_notify(''{"action":"deadline"}''::jsonb)');
  perform cron.schedule('deadline-reminder-sat', '30 23 * * 5', 'select public.call_notify(''{"action":"deadline"}''::jsonb)');
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;
