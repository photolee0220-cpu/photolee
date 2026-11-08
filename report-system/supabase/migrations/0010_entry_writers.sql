-- 작성 현황을 '마지막으로 저장한 사람'이 아니라 '그 칸에 쓴 사람 모두'로 센다.
-- 현장 칸은 부서가 함께 쓰므로, 같은 칸을 다른 사람이 나중에 고치면 먼저 쓴 사람이 미작성으로 보이던 문제를 고친다.

alter table public.entries add column if not exists writers uuid[] not null default '{}';

create or replace function public.track_entry_writers() returns trigger
language plpgsql set search_path = public as $$
begin
  -- 한 번 쓴 사람은 지워지지 않게 이전 목록과 합친다
  if tg_op = 'UPDATE' then
    new.writers := array(select distinct x from unnest(coalesce(old.writers, '{}') || coalesce(new.writers, '{}')) x);
  end if;
  new.writers := coalesce(new.writers, '{}');
  if new.updated_by is not null and new.content <> '' and not (new.updated_by = any(new.writers)) then
    new.writers := new.writers || new.updated_by;
  end if;
  return new;
end $$;

drop trigger if exists track_entry_writers on public.entries;
create trigger track_entry_writers before insert or update on public.entries
  for each row execute function public.track_entry_writers();

-- 지금까지 쓴 사람 채우기: 현재 마지막 저장자 + 수정 이력에 남은 사람(내용이 있던 것만)
update public.entries e set writers = coalesce((
  select array_agg(distinct w) from (
    select e.updated_by as w where e.updated_by is not null and e.content <> ''
    union
    select h.edited_by from public.entry_history h
     where h.entry_id = e.id and h.edited_by is not null and h.content <> ''
  ) s
), '{}');

-- 주차 목록의 작성자 수도 같은 기준으로
create or replace function public.week_summaries() returns table (week_id date, entry_count bigint, writers bigint)
language sql stable security invoker set search_path = public as $$
  select w.id, count(e.id) filter (where e.content <> ''),
    (select count(distinct x) from public.entries e2, unnest(e2.writers) x where e2.week_id = w.id and e2.content <> '')
  from public.weeks w left join public.entries e on e.week_id = w.id
  group by w.id order by w.id desc
$$;
