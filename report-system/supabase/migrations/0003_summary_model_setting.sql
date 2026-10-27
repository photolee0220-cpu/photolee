-- AI 요약 모델 설정 (관리자 페이지 > 설정)
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "read" on public.app_settings for select to authenticated using (public.is_member());
create policy "admin write" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values ('summary_model', '"claude-haiku-5-5"') on conflict (key) do nothing;

alter table public.ai_summaries add column model text;
