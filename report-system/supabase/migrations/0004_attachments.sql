-- 보고 칸 첨부파일, 저장 공간 사용량
-- 배포 작업(provision-supabase)이 아직 적용하지 않은 migrations 파일을 순서대로 실행한다.

-- 적용된 마이그레이션 기록 (배포 작업만 쓴다)
create table if not exists public.app_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.app_migrations enable row level security;

-- ───────────── 첨부파일 ─────────────
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id),
  kind text not null check (kind in ('site', 'dept', 'misc')),
  site_id uuid references public.sites (id),
  department_id uuid not null references public.departments (id),
  author_id uuid references public.members (id),
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint not null default 0,
  mime_type text not null default 'application/octet-stream',
  uploaded_by uuid not null default auth.uid() references public.members (id),
  created_at timestamptz not null default now()
);
create index attachments_week_idx on public.attachments (week_id);

alter table public.attachments enable row level security;
create policy "read" on public.attachments for select to authenticated using (public.can_view_dept(department_id));
-- 그 칸을 쓸 수 있는 사람만 올린다 (현장·기타는 같은 부서, 개인 보고는 본인)
create policy "upload editable" on public.attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_edit_entry(kind, department_id, author_id));
create policy "delete own" on public.attachments for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- 비공개 버킷, 파일당 20MB. 경로는 '부서ID/주차/파일'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-files', 'report-files', false, 20971520, null)
on conflict (id) do nothing;

create policy "report files read" on storage.objects for select to authenticated
  using (bucket_id = 'report-files' and public.can_view_dept(((storage.foldername(name))[1])::uuid));
create policy "report files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-files' and (public.is_admin() or ((storage.foldername(name))[1])::uuid = public.my_department()));
create policy "report files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'report-files' and (owner = auth.uid() or public.is_admin()));

alter publication supabase_realtime add table public.attachments;

-- ───────────── 저장 공간 사용량 (관리자 전용) ─────────────
create or replace function public.storage_usage()
returns table (bucket_id text, objects bigint, bytes bigint)
language plpgsql stable security definer set search_path = public, storage as $$
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다.'; end if;
  return query
    select o.bucket_id::text, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
    where o.bucket_id in ('site-photos', 'report-files')
    group by o.bucket_id;
end $$;
grant execute on function public.storage_usage() to authenticated;
