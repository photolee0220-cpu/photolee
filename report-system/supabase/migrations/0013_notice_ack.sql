-- 업무보고 작성 안내 확인: 직원이 안내를 읽고 [확인]한 기록 (누가 언제, 몇 번째 안내)
alter table public.members
  add column if not exists notice_ack_version int not null default 0,
  add column if not exists notice_ack_at timestamptz;

-- 관리자가 안내를 바꾸고 '다시 확인받기'를 누르면 이 번호가 올라가 모두 다시 확인한다
insert into public.app_settings (key, value) values ('notice_version', '1') on conflict (key) do nothing;

create or replace function public.ack_report_notice() returns void
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  select coalesce((value #>> '{}')::int, 1) into v from public.app_settings where key = 'notice_version';
  update public.members set notice_ack_version = coalesce(v, 1), notice_ack_at = now() where id = auth.uid() and active;
end $$;
revoke all on function public.ack_report_notice() from public, anon;
grant execute on function public.ack_report_notice() to authenticated;
