-- 업무 분석: 부서별 일일보고·주간보고를 매주 AI가 정리한다
--  · 찐관리자(username = 'admin' 계정)만 읽고 쓴다. 대표님·다른 관리자도 못 본다
--  · 분석은 서버 함수(weekly-summary, mode 'workmap')가 만들어 저장한다
--  · 매주 월요일 오전 7시(한국 시간) 지난주를 자동 분석

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = auth.uid() and active and is_admin and username = 'admin')
$$;

create table public.work_analyses (
  week_id date not null,
  department_id uuid not null references public.departments (id) on delete cascade,
  report_count int not null default 0,
  result jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (week_id, department_id)
);
alter table public.work_analyses enable row level security;
create policy "owner" on public.work_analyses for select to authenticated using (public.is_owner());

-- 분석 진행 상태 (주마다 한 줄)
create table public.work_runs (
  week_id date primary key,
  status text not null check (status in ('running', 'done', 'error')),
  total int not null default 0,
  done int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.work_runs enable row level security;
create policy "owner" on public.work_runs for select to authenticated using (public.is_owner());

-- 개선 목록
create table public.work_ideas (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,
  task text not null,
  level text not null default 'assist' check (level in ('replace', 'assist', 'human')),
  how text not null default '',
  system text not null default '',
  effort text not null default 'mid' check (effort in ('low', 'mid', 'high')),
  impact text not null default 'mid' check (impact in ('low', 'mid', 'high')),
  status text not null default 'idea' check (status in ('idea', 'review', 'pilot', 'done', 'hold')),
  note text not null default '',
  week_id date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.work_ideas enable row level security;
create policy "owner" on public.work_ideas for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- 서버 함수 부르기 (예약 작업용, call_notify와 같은 방식)
create or replace function public.call_fn(fn text, body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  fn_url text := (select value from public.app_secrets where key = 'functions_url');
  anon text := (select value from public.app_secrets where key = 'anon_key');
  secret text := (select value from public.app_secrets where key = 'cron_secret');
begin
  if fn_url is null or anon is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using fn_url || '/' || fn, body || jsonb_build_object('secret', secret),
          jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || anon);
exception when others then
  raise notice 'call_fn skipped: %', sqlerrm;
end $$;
revoke all on function public.call_fn(text, jsonb) from public, anon, authenticated;

-- 월요일 07:00 KST = 일요일 22:00 UTC
do $$
begin
  perform cron.unschedule('workmap-weekly') where exists (select 1 from cron.job where jobname = 'workmap-weekly');
  perform cron.schedule('workmap-weekly', '0 22 * * 0', $job$
    select public.call_fn('weekly-summary', jsonb_build_object('mode', 'workmap', 'weekId', (date_trunc('week', now() at time zone 'Asia/Seoul'))::date::text))
  $job$);
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;
