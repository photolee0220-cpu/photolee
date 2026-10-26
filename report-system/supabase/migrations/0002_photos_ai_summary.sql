-- 현장 사진, AI 주간 요약
-- 0001 다음에 SQL Editor에서 한 번 실행합니다.

-- ───────────── 현장 사진 ─────────────
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id),
  site_id uuid not null references public.sites (id),
  department_id uuid not null references public.departments (id),
  storage_path text not null unique,
  caption text not null default '',
  width int,
  height int,
  uploaded_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);
create index photos_week_idx on public.photos (week_id);
create index photos_site_idx on public.photos (site_id);

alter table public.photos enable row level security;
create policy "read" on public.photos for select to authenticated using (public.can_view_dept(department_id));
create policy "upload own dept" on public.photos for insert to authenticated
  with check (uploaded_by = auth.uid() and (public.is_admin() or department_id = public.my_department()));
create policy "delete own" on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- 파일은 비공개 버킷에 '부서ID/주차/파일' 경로로 저장한다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy "site photos read" on storage.objects for select to authenticated
  using (bucket_id = 'site-photos' and public.can_view_dept(((storage.foldername(name))[1])::uuid));
create policy "site photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'site-photos' and (public.is_admin() or ((storage.foldername(name))[1])::uuid = public.my_department()));
create policy "site photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'site-photos' and (owner = auth.uid() or public.is_admin()));

-- ───────────── AI 주간 요약 (대표 전용) ─────────────
create table public.ai_summaries (
  week_id date primary key references public.weeks (id),
  highlights jsonb not null,
  site_changes jsonb not null default '[]',
  generated_at timestamptz not null default now(),
  generated_by uuid references public.members (id),
  source_updated_at text
);
alter table public.ai_summaries enable row level security;
-- 쓰기는 weekly-summary 함수(서비스 키)만 한다
create policy "ceo read" on public.ai_summaries for select to authenticated using (public.is_ceo());

alter publication supabase_realtime add table public.photos;
