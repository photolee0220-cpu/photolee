-- 주간보고 작성 대상 스위치: 계정은 있지만 주간보고를 쓰지 않는 사람(채팅·공지만 쓰는 직원 등)은
-- 미작성 집계와 마감 알림에서 빠진다. 기본은 작성 대상.
alter table public.members add column if not exists weekly_enabled boolean not null default true;
