import { ChevronRight, Search } from 'lucide-react';
import { RichLines } from '../components/RichText';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { DirectiveStatusBar } from '../components/editors';
import { Empty, Input, Segmented, Spinner, StageChip } from '../components/ui';
import { canSeeAll } from '../lib/access';
import { api } from '../lib/client';
import type { Directive } from '../lib/types';
import { toIsoDate, weekLabelLong } from '../lib/week';
import { useStore } from '../state/store';

type Period = '1' | '3' | '0';
type StatusFilter = 'todo' | 'done' | 'all';

/** 지시사항 모아보기: 지난 주차까지 대표님 지시를 찾아보고 처리 상태를 체크한다 */
export function DirectivesPage() {
  const { snap, me, setWeekId, openDrawer, toast } = useStore();
  const [list, setList] = useState<Directive[] | null>(null);
  const [period, setPeriod] = useState<Period>('3');
  const [status, setStatus] = useState<StatusFilter>('todo');
  const [q, setQ] = useState('');
  useEffect(() => {
    api.directiveHistory().then(setList).catch((e) => { toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error'); setList([]); });
  }, [toast]);

  const writesSites = !!snap?.departments.find((d) => d.id === me.departmentId)?.writesSites;
  const sites = useMemo(() => new Map((snap?.sites ?? []).map((s) => [s.id, s])), [snap]);
  const members = useMemo(() => new Map((snap?.members ?? []).map((m) => [m.id, m])), [snap]);
  if (!snap || !list) return <div className="flex justify-center py-20"><Spinner /></div>;

  // 대표·관리자·본부장은 전체, 직원은 내 개인 지시와 (현장 보고 부서면) 현장 지시
  const mine = list.filter((d) => canSeeAll(me) || (d.targetKind === 'member' ? d.memberId === me.id : writesSites));
  const cutoff = period === '0' ? '' : toIsoDate(new Date(Date.now() - Number(period) * 30.5 * 86400000));
  const label = (d: Directive) => {
    if (d.targetKind === 'site') return sites.get(d.siteId ?? '')?.name ?? '현장';
    const m = members.get(d.memberId ?? '');
    return `${m?.name ?? ''} ${m?.title ?? ''}`.trim();
  };
  const term = q.trim();
  const shown = mine.filter((d) => (!cutoff || d.weekId >= cutoff)
    && (status === 'all' || (status === 'done' ? d.status === 'done' : d.status !== 'done'))
    && (!term || d.content.includes(term) || label(d).includes(term)));
  const weeks = [...new Set(shown.map((d) => d.weekId))];
  const todo = mine.filter((d) => (!cutoff || d.weekId >= cutoff) && d.status !== 'done').length;

  const replace = (d: Directive) => setList((xs) => xs && xs.map((x) => (x.id === d.id ? d : x)));
  const open = (d: Directive) => {
    setWeekId(d.weekId);
    if (d.targetKind === 'site' && d.siteId) openDrawer({ type: 'site', id: d.siteId });
    else if (d.memberId) openDrawer({ type: 'person', id: d.memberId });
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="지시사항">
        <span className="text-[13px] text-ink-3">지난 주차 지시도 처리 상태를 바꿀 수 있습니다{canSeeAll(me) ? '' : ' · 내 개인 지시와 우리 부서가 쓰는 현장 지시'}</span>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented<StatusFilter> value={status} onChange={setStatus} options={[
          { id: 'todo', label: `미완료 ${todo}` },
          { id: 'done', label: '완료' },
          { id: 'all', label: '전체' },
        ]} />
        <Segmented<Period> value={period} onChange={setPeriod} options={[
          { id: '1', label: '1개월' },
          { id: '3', label: '3개월' },
          { id: '0', label: '전체 기간' },
        ]} />
        <div className="relative ml-auto w-full sm:w-56">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="현장·이름·내용 검색" className="!pl-9" aria-label="지시사항 검색" />
        </div>
      </div>

      {weeks.length === 0 ? (
        <Empty title={status === 'todo' ? '미완료 지시가 없습니다' : '해당하는 지시가 없습니다'}>기간이나 상태를 바꿔 보세요.</Empty>
      ) : (
        <div className="space-y-7">
          {weeks.map((w) => (
            <section key={w}>
              <h2 className="mb-2.5 text-[14px] font-bold text-ink-2">{weekLabelLong(w)}</h2>
              <div className="space-y-2.5">
                {shown.filter((d) => d.weekId === w).map((d) => {
                  const site = d.targetKind === 'site' ? sites.get(d.siteId ?? '') : undefined;
                  return (
                    <article key={d.id} className="rounded-2xl border border-note-line bg-note px-4 py-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => open(d)} className="inline-flex items-center gap-0.5 text-[14px] font-bold hover:text-brand-ink hover:underline">
                          {label(d)}<ChevronRight size={14} className="text-ink-3" />
                        </button>
                        {site ? <StageChip stage={site.stage} /> : <span className="text-[12px] font-semibold text-note-ink">개인 지시</span>}
                      </div>
                      <p className="whitespace-pre-wrap text-[14px] leading-[1.65]"><RichLines text={d.content} /></p>
                      <DirectiveStatusBar directive={d} onChanged={replace} />
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
