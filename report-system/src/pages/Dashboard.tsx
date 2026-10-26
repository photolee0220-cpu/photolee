import { AlertTriangle, ArrowRight, Download, Landmark, Lock, MessageSquareText, StickyNote, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { DirectiveBox } from '../components/editors';
import { dueInfo, isImminent, SiteCard } from '../components/SiteCard';
import { Badge, Button, Card, cx, Empty, Progress, Segmented, Select, Spinner } from '../components/ui';
import { canViewFinance } from '../lib/access';
import { hasWritten, isCompleted, miscDirective, reporters, visibleSites } from '../lib/derive';
import { STAGES, type Site, type Stage } from '../lib/types';
import { dday } from '../lib/week';
import { useStore } from '../state/store';
import { useExport } from './useExport';
import { PeopleGrid } from './People';

type SortKey = 'order' | 'progress' | 'due';

export function Dashboard() {
  const { snap, loading, me, weekId, openDrawer, saveDirective, setView } = useStore();
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('order');
  const [tag, setTag] = useState<string | null>(null);
  const exportWeek = useExport();

  const sites = useMemo(() => (snap ? visibleSites(snap) : []), [snap]);
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;

  const people = reporters(snap);
  const done = people.filter((m) => hasWritten(snap, m.id));
  const missing = people.filter((m) => !hasWritten(snap, m.id));
  const counts = Object.fromEntries(STAGES.map((s) => [s.id, sites.filter((x) => x.stage === s.id).length])) as Record<Stage, number>;
  const active = sites.filter((s) => s.stage === 'construction' && !isCompleted(s));
  const withProgress = active.filter((s) => s.progress != null);
  const avg = withProgress.length ? Math.round(withProgress.reduce((n, s) => n + s.progress!, 0) / withProgress.length) : null;
  const imminent = sites.filter(isImminent);
  const overdue = active.filter((s) => (dday(s.dueDate) ?? 0) < 0);
  const ceoComments = snap.comments.filter((c) => snap.members.find((m) => m.id === c.authorId)?.isCeo);
  const acked = ceoComments.filter((c) => c.acknowledgedAt);
  const tags = [...new Set(sites.flatMap((s) => s.tags))];
  const special = miscDirective(snap.directives, 'special');
  const myDeptName = snap.departments.find((d) => d.id === me.departmentId)?.name;

  let list = sites.filter((s) => (stage === 'all' || s.stage === stage) && (!tag || s.tags.includes(tag)));
  if (sort === 'progress') list = [...list].sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1));
  if (sort === 'due') list = [...list].sort((a, b) => dueRank(a) - dueRank(b));

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title={me.isCeo ? '대표님 대시보드' : '전체 현황'}
        right={<>
          <WeekSwitcher />
          <Button onClick={() => exportWeek(snap)}><Download size={16} />엑셀 내려받기</Button>
        </>}
      >
        <DeadlineBadge />
        {loading && <Spinner className="h-3.5 w-3.5" />}
      </PageHeader>

      {/* 요약 */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="작성 현황" icon={<Users size={15} />}>
          <p className="text-[26px] font-extrabold tabular leading-none">{done.length}<span className="text-[15px] font-bold text-ink-3"> / {people.length}명</span></p>
          <Progress value={people.length ? (done.length / people.length) * 100 : 0} className="mt-2.5" />
          {missing.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[12px] font-semibold text-ink-3">미작성</span>
              {missing.slice(0, 6).map((m) => (
                <button key={m.id} onClick={() => openDrawer({ type: 'person', id: m.id })} className="rounded-md bg-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ink-2 hover:bg-line">{m.name}</button>
              ))}
              {missing.length > 6 && <span className="text-[12px] text-ink-3">외 {missing.length - 6}명</span>}
            </div>
          ) : <p className="mt-2.5 text-[12.5px] font-semibold text-ok">모두 작성했습니다</p>}
        </Tile>
        <Tile label="진행 현장" icon={<Landmark size={15} />}>
          <p className="text-[26px] font-extrabold tabular leading-none">{active.length}<span className="text-[15px] font-bold text-ink-3"> 곳 공사 중</span></p>
          <p className="mt-2 text-[12.5px] text-ink-3">CM {counts.cm} · 영업 {counts.sales} · 준공완료 {counts.construction - active.length}</p>
          {avg != null && <p className="mt-1 text-[12.5px] font-semibold text-ink-2">평균 공정율 {avg}%</p>}
        </Tile>
        <Tile label="준공 일정" icon={<AlertTriangle size={15} />}>
          <p className="text-[26px] font-extrabold tabular leading-none">{imminent.length}<span className="text-[15px] font-bold text-ink-3"> 곳 90일 이내</span></p>
          <div className="mt-2 space-y-0.5 text-[12.5px]">
            {imminent.slice(0, 2).map((s) => <p key={s.id} className="truncate font-semibold text-warn">{s.name} · {dueInfo(s).label.split('· ')[1]}</p>)}
            {overdue.length > 0 && <p className="font-semibold text-danger">예정일 지난 현장 {overdue.length}곳</p>}
            {!imminent.length && !overdue.length && <p className="text-ink-3">임박한 준공이 없습니다</p>}
          </div>
        </Tile>
        <Tile label="대표님 피드백" icon={<MessageSquareText size={15} />}>
          {ceoComments.length ? (
            <>
              <p className="text-[26px] font-extrabold tabular leading-none">{acked.length}<span className="text-[15px] font-bold text-ink-3"> / {ceoComments.length}건 확인</span></p>
              <Progress value={(acked.length / ceoComments.length) * 100} className="mt-2.5" />
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-ink-3">아직 남긴 피드백이 없습니다. 현장이나 보고를 열어 내용 아래에 바로 남길 수 있습니다.</p>
          )}
        </Tile>
      </div>

      {/* 특별 지시 */}
      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[1fr_auto]">
        <DirectiveBox
          key={`${weekId}-special`}
          label="주간 특별 지시사항 · 전 직원에게 보입니다"
          value={special?.content ?? ''}
          prevContent={miscDirective(snap.prevDirectives, 'special')?.content}
          editable={me.isCeo}
          onSave={(content) => saveDirective({ weekId, targetKind: 'misc', siteId: null, memberId: null, slot: 'special', content })}
        />
        <Card onClick={() => openDrawer({ type: 'misc' })} className="flex items-center gap-3 p-4 lg:w-[260px]">
          <StickyNote size={20} className="shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">기타사항</p>
            <p className="text-[12.5px] text-ink-3">대표 진행사항 · 의뢰 진행 · 부서 기타</p>
          </div>
          <ArrowRight size={16} className="text-ink-3" />
        </Card>
      </div>

      {/* 공정율 한눈에 + 이슈 */}
      <div className="mt-8 grid items-start gap-4 xl:grid-cols-[1.7fr_1fr]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-bold">공사 현장 공정율</h2>
            <span className="text-[12px] text-ink-3">막대를 누르면 현장 상세가 열립니다</span>
          </div>
          <ProgressChart sites={sites.filter((s) => s.stage === 'construction')} onOpen={(id) => openDrawer({ type: 'site', id })} />
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-[16px] font-bold">이슈별 현장</h2>
          <IssueBoard sites={sites} onOpen={(id) => openDrawer({ type: 'site', id })} />
        </Card>
      </div>

      {/* 현장 카드 */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-[17px] font-bold">현장 현황</h2>
          <Segmented<Stage | 'all'> value={stage} onChange={setStage} options={[
            { id: 'all', label: `전체 ${sites.length}` },
            ...STAGES.map((s) => ({ id: s.id, label: `${s.short} ${counts[s.id]}` })),
          ]} />
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="!h-9 !w-auto text-[13px]" aria-label="정렬">
            <option value="order">등록순</option>
            <option value="progress">공정율 높은순</option>
            <option value="due">준공 임박순</option>
          </Select>
          <button onClick={() => setView('table')} className="ml-auto text-[13px] font-semibold text-brand-ink hover:underline">엑셀처럼 표로 보기</button>
        </div>
        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button key={t} onClick={() => setTag(tag === t ? null : t)}
                className={cx('rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                  tag === t ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface text-ink-2 hover:border-brand')}>
                {t}
              </button>
            ))}
          </div>
        )}
        {list.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {list.map((s) => <SiteCard key={s.id} site={s} snap={snap} onOpen={() => openDrawer({ type: 'site', id: s.id })} />)}
          </div>
        ) : <Empty title="조건에 맞는 현장이 없습니다" />}
      </section>

      {/* 부서 보고 */}
      <section className="mt-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-bold">부서별 보고</h2>
          <button onClick={() => setView('people')} className="text-[13px] font-semibold text-brand-ink hover:underline">전체 보기</button>
        </div>
        <PeopleGrid compact />
      </section>

      {/* 회계 */}
      {canViewFinance(me, myDeptName) && (
        <section className="mt-10">
          <h2 className="mb-3 text-[17px] font-bold">회계 현황 <Badge tone="neutral" className="ml-1 align-middle"><Lock size={11} />대표·회계팀만</Badge></h2>
          <Card className="grid gap-4 p-5 md:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="font-bold">회계 엑셀을 올리면 여기에 자동으로 정리됩니다</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
                회계팀이 매주 쓰는 자금일보·자금집행·기성수금 파일 샘플을 받으면 연결합니다. 금액은 대표님과 회계팀에게만 보입니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 opacity-60" aria-hidden>
              {['총 미수금', '이번 주 입금', '이번 주 출금', '대출 진행 중'].map((l) => (
                <div key={l} className="rounded-lg border border-dashed border-line-strong p-3">
                  <p className="text-[12px] font-semibold text-ink-3">{l}</p>
                  <p className="mt-1 text-[18px] font-extrabold text-ink-3">— 원</p>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}
    </div>
  );
}

function dueRank(s: Site): number {
  if (s.stage !== 'construction' || isCompleted(s)) return 1e6 + s.sort;
  const d = dday(s.dueDate);
  return d == null ? 5e5 + s.sort : d;
}

function Tile({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <p className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-bold text-ink-3">{icon}{label}</p>
      {children}
    </Card>
  );
}

function ProgressChart({ sites, onOpen }: { sites: Site[]; onOpen(id: string): void }) {
  const rows = sites.filter((s) => s.progress != null).sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0));
  const others = sites.filter((s) => s.progress == null);
  if (!rows.length) return <Empty title="공정율이 입력된 현장이 없습니다" />;
  return (
    <div>
      <div className="space-y-1">
        {rows.map((s) => {
          const due = dueInfo(s);
          const done = isCompleted(s);
          return (
            <button key={s.id} onClick={() => onOpen(s.id)} className="group grid w-full grid-cols-[minmax(0,8rem)_1fr_2.75rem] items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-sunken sm:grid-cols-[minmax(0,11rem)_1fr_2.75rem_5.5rem]">
              <span className="truncate text-[13px] font-semibold">{s.name}</span>
              <span className="relative h-3 overflow-hidden rounded-full bg-sunken">
                {[25, 50, 75].map((t) => <span key={t} className="absolute inset-y-0 w-px bg-line-strong/60" style={{ left: `${t}%` }} />)}
                <span className={cx('absolute inset-y-0 left-0 rounded-full', done ? 'bg-ok/70' : 'bg-brand')} style={{ width: `${s.progress}%` }} />
              </span>
              <span className={cx('text-right text-[13px] font-bold tabular', done && 'text-ok')}>{s.progress}%</span>
              <span className={cx('hidden truncate text-right text-[12px] tabular sm:block', due.tone === 'warn' ? 'font-semibold text-warn' : due.tone === 'danger' ? 'font-semibold text-danger' : 'text-ink-3')}>
                {done ? '준공완료' : s.dueDate ? due.label.split('· ')[1] : '미정'}
              </span>
            </button>
          );
        })}
      </div>
      {others.length > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">
          공정율 미입력: {others.map((s, i) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className="font-semibold text-ink-2 hover:underline">{s.name}{s.scale ? `(${s.scale})` : ''}{i < others.length - 1 ? ', ' : ''}</button>
          ))}
        </p>
      )}
    </div>
  );
}

function IssueBoard({ sites, onOpen }: { sites: Site[]; onOpen(id: string): void }) {
  const groups = new Map<string, Site[]>();
  const imminent = sites.filter(isImminent);
  if (imminent.length) groups.set('준공임박', imminent);
  for (const s of sites) for (const t of s.tags) groups.set(t, [...(groups.get(t) ?? []), s]);
  if (!groups.size) return <Empty title="이슈가 표시된 현장이 없습니다">관리자 페이지에서 현장마다 이슈 태그를 붙일 수 있습니다.</Empty>;
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([t, list]) => (
        <div key={t}>
          <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold">
            <Badge tone={t === '준공임박' ? 'warn' : t === '소송·분쟁' ? 'danger' : 'neutral'}>{t}</Badge>
            <span className="text-ink-3">{list.length}곳</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {list.map((s) => (
              <button key={s.id} onClick={() => onOpen(s.id)} className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[12.5px] font-semibold hover:border-line-strong hover:bg-sunken">
                {s.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

