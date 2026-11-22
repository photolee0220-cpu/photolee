-- AI 월 예산: 시스템 안의 모든 AI 사용량(토큰·추정 금액)을 기록하고, 한 달 예산을 넘지 않게 서버 함수가 막는다
--  · 기본 한 달 10,000원 (환율 1달러 = 1,400원으로 계산). 관리자(admin 계정)가 업무 분석 화면에서 바꿀 수 있다
--  · 업무 분석은 Opus로 하면 예산에 가까워질 때 Sonnet으로 바꾸고, 그래도 넘치면 그 주는 쉰다
--  · 기록은 admin 계정만 읽는다 (쓰기는 서버 함수만)

create table public.ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  feature text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  batch boolean not null default false,
  units int not null default 1,
  cost_usd numeric(12, 6) not null default 0,
  ref text
);
create index ai_usage_at_idx on public.ai_usage (at);
alter table public.ai_usage enable row level security;
create policy "owner" on public.ai_usage for select to authenticated using (public.is_owner());

insert into public.app_settings (key, value) values ('ai_budget', '{"monthlyKrw": 10000, "krwPerUsd": 1400}'::jsonb)
on conflict (key) do nothing;
