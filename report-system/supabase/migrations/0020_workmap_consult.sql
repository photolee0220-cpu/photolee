-- 업무 분석 2단계: 경영 컨설팅 수준 분석
--  · Claude Opus 5.5를 Message Batches로 보낸다 (시간 제한 없음, 요금 절반). 끝나면 결과를 모아 저장
--  · 예전(Haiku) 분석은 그대로 두고, 진행 기록만 지워 최근 4주를 새 방식으로 다시 분석하게 한다

alter table public.work_runs add column if not exists batch_id text;
alter table public.work_runs add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.work_ideas add column if not exists extra jsonb not null default '{}'::jsonb;

delete from public.work_runs;

-- 5분마다: 진행 중인 분석이 있으면 결과를 모으러 간다
do $$
begin
  perform cron.unschedule('workmap-collect') where exists (select 1 from cron.job where jobname = 'workmap-collect');
  perform cron.schedule('workmap-collect', '*/5 * * * *', $job$
    select public.call_fn('weekly-summary', '{"mode":"workmap-collect"}'::jsonb)
    where exists (select 1 from public.work_runs where status = 'running' and batch_id is not null)
  $job$);
exception when others then raise notice 'cron schedule skipped: %', sqlerrm;
end $$;
