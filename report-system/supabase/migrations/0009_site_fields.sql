-- 현장 설명 항목: 관리자가 항목(연면적, 도급금액 등)을 추가·삭제하고 현장마다 값을 넣는다. 모든 직원이 본다

create table public.site_fields (
  id text primary key,
  label text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.site_fields (id, label, sort) values
  ('contract_amount', '도급금액', 1),
  ('client', '발주처', 2),
  ('floor_area', '연면적', 3)
on conflict (id) do nothing;

alter table public.site_fields enable row level security;
create policy "read" on public.site_fields for select to authenticated using (public.is_member());
create policy "admin write" on public.site_fields for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.site_fields for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin delete" on public.site_fields for delete to authenticated using (public.is_admin());

-- 항목 id → 값. 항목을 지워도 값은 남지만 화면에는 나오지 않는다
alter table public.sites add column extra jsonb not null default '{}'::jsonb;

alter publication supabase_realtime add table public.site_fields;

-- 백업에 현장 설명 항목도 담는다
create or replace function public.make_backup(p_kind text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  doc jsonb;
  new_id bigint;
begin
  doc := jsonb_build_object(
    'version', 2,
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
