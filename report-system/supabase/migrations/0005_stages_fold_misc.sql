-- 현장 단계 직접 관리, 기타사항 → 부서 업무보고 통합, 현장 보고 작성 여부 공개

-- ───────────── 현장 단계 (관리자가 추가·이름 변경·순서 변경) ─────────────
create table public.stages (
  id text primary key,
  label text not null,
  short text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.stages (id, label, short, sort) values
  ('construction', '공사진행현장', '공사진행', 1),
  ('cm', 'CM진행현장', 'CM', 2),
  ('sales', '영업현장', '영업', 3)
on conflict (id) do nothing;

alter table public.sites drop constraint if exists sites_stage_check;
alter table public.sites add constraint sites_stage_fk foreign key (stage) references public.stages (id) on update cascade;

alter table public.stages enable row level security;
create policy "read" on public.stages for select to authenticated using (public.is_member());
create policy "admin write" on public.stages for insert to authenticated with check (public.is_admin());
create policy "admin update" on public.stages for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- 현장이 남아 있는 단계는 외래키 때문에 지워지지 않는다
create policy "admin delete" on public.stages for delete to authenticated using (public.is_admin());
alter publication supabase_realtime add table public.stages;

-- ───────────── 기타사항 없애기: 쓴 사람의 부서 업무보고 끝에 '■ 기타사항'으로 옮긴다 ─────────────
do $$
declare
  r record;
  who uuid;
  dept uuid;
  target uuid;
begin
  for r in select * from public.entries where kind = 'misc' order by week_id loop
    who := r.updated_by;
    if who is null then
      select m.id into who from public.members m where m.department_id = r.department_id and m.active order by m.name limit 1;
    end if;
    continue when who is null;
    select coalesce(m.department_id, r.department_id) into dept from public.members m where m.id = who;
    if btrim(r.content) <> '' then
      target := null;
      select e.id into target from public.entries e where e.kind = 'dept' and e.week_id = r.week_id and e.author_id = who;
      if target is null then
        insert into public.entries (week_id, kind, department_id, author_id, content, updated_at, updated_by)
        values (r.week_id, 'dept', dept, who, '■ 기타사항' || E'\n' || r.content, r.updated_at, who)
        returning id into target;
      else
        update public.entries set content = case when btrim(content) = '' then '■ 기타사항' || E'\n' || r.content
          else rtrim(content, E' \n\t') || E'\n\n■ 기타사항\n' || r.content end
        where id = target;
      end if;
      update public.comments set entry_id = target where entry_id = r.id;
    end if;
    update public.attachments set kind = 'dept', author_id = who
      where kind = 'misc' and department_id = r.department_id and week_id = r.week_id;
    delete from public.entries where id = r.id;
  end loop;
  update public.attachments set kind = 'dept', author_id = uploaded_by where kind = 'misc';
end $$;

-- 앞으로는 현장 칸과 본인 부서 업무보고만 쓴다
create or replace function public.can_edit_entry(p_kind text, p_dept uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or (p_kind = 'dept' and p_author = auth.uid())
    or (p_kind = 'site' and p_dept = public.my_department())
$$;

-- ───────────── 현장 보고 작성 여부 (내용 없이) ─────────────
-- 현장 화면에서 보고한 부서는 모두 보이고, 내용은 열람 권한이 있을 때만 entries에서 읽힌다
create or replace function public.site_report_status(p_week date)
returns table (site_id uuid, department_id uuid, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then raise exception '로그인이 필요합니다.'; end if;
  return query
    select e.site_id, e.department_id, e.updated_at
    from public.entries e
    where e.kind = 'site' and e.week_id = p_week and btrim(e.content) <> '';
end $$;
grant execute on function public.site_report_status(date) to authenticated;
