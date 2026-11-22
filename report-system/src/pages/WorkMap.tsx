import { Check, ChevronRight, Copy, FileText, Lock, Plus, Printer, RefreshCw, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, Card, cx, Empty, Input, Modal, Segmented, Select, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { activeDepartments } from '../lib/derive';
import type { Department, WeekId } from '../lib/types';
import { parseIsoDate, shiftDay } from '../lib/week';
import {
  APPROACH_LABEL, GRADE_LABEL, IDEA_STATUS, LEVEL_LABEL, REPLACE_LABEL, ideaScore, isOwner,
  type IdeaLevel, type IdeaStatus, type WorkAnalysis, type WorkIdea, type WorkIdeaSuggestion, type WorkRun,
} from '../lib/workmapTypes';
import { useStore } from '../state/store';

/** 보고일(월) 기준 그 앞 한 주 */
export function workWeekLabel(w: WeekId): string {
  const a = parseIsoDate(shiftDay(w, -7));
  const b = parseIsoDate(shiftDay(w, -2));
  return `${a.getMonth() + 1}/${a.getDate()}~${b.getMonth() + 1}/${b.getDate()} 업무`;
}

const levelTone = (l: IdeaLevel) => (l === 'replace' ? 'brand' : l === 'assist' ? 'ok' : 'neutral') as 'brand' | 'ok' | 'neutral';
const ideaKey = (deptId: string, task: string) => `${deptId}|${task}`;

type Tab = 'week' | 'map' | 'ideas';

/** 업무 분석: 부서별 보고를 매주 AI가 정리 → 업무 지도 → AI 활용 후보 → 개선 목록. 찐관리자(admin)만 */
export function WorkMapPage() {
  const { me, snap, toast } = useStore();
  const [tab, setTab] = useState<Tab>('week');
  const [all, setAll] = useState<WorkAnalysis[] | null>(null);
  const [runs, setRuns] = useState<WorkRun[]>([]);
  const [ideas, setIdeas] = useState<WorkIdea[]>([]);
  const [week, setWeek] = useState<WeekId | null>(null);
  const [report, setReport] = useState(false);
  const depts = useMemo(() => (snap ? activeDepartments(snap) : []), [snap]);
  const running = runs.filter((r) => r.status === 'running');

  const reload = useCallback(async () => {
    const [x, r] = await Promise.all([api.workmap.list(), api.workmap.runs()]);
    setAll(x); setRuns(r);
    setWeek((w) => w ?? x[0]?.weekId ?? null);
  }, []);

  useEffect(() => {
    if (!isOwner(me)) return;
    // 최근 4주 중 아직 분석하지 않은 주가 있으면 시작 (뒤에서 진행)
    api.workmap.ensureRecent().catch((e) => toast(e instanceof Error ? e.message : '분석을 시작하지 못했습니다.', 'error'))
      .finally(() => void reload().catch((e) => { setAll([]); toast(e instanceof Error ? e.message : '분석을 불러오지 못했습니다.', 'error'); }));
    api.workmap.ideas().then(setIdeas).catch(() => undefined);
  }, [me, toast, reload]);

  // 진행 중인 분석이 있으면 15초마다 확인 (끝나면 바로 화면에 나온다)
  useEffect(() => {
    if (!running.length) return;
    const t = setInterval(() => {
      api.workmap.runs().then(async (r) => {
        setRuns(r);
        if (r.filter((x) => x.status === 'running').length < running.length) { setAll(await api.workmap.list()); toast('분석이 끝났습니다.'); }
      }).catch(() => undefined);
    }, api.mode === 'demo' ? 2000 : 15000);
    return () => clearInterval(t);
  }, [running.length, toast]);

  if (!isOwner(me)) return <Empty title="관리자(admin) 계정만 볼 수 있는 화면입니다" icon={<Lock size={22} />} />;
  if (!all) return <div className="flex justify-center py-20"><Spinner /></div>;

  const weeks = [...new Set(all.map((a) => a.weekId))].sort().reverse();
  const recent = weeks.slice(0, 4);
  const added = new Set(ideas.map((i) => ideaKey(i.departmentId, i.task)));
  const regenerate = async (w: WeekId) => {
    try {
      await api.workmap.generate(w);
      setRuns(await api.workmap.runs());
      toast('다시 분석을 시작했습니다. 끝나면 여기에 바로 나타납니다.');
    } catch (e) { toast(e instanceof Error ? e.message : '분석을 시작하지 못했습니다.', 'error'); }
  };
  const addIdea = async (deptId: string, s: WorkIdeaSuggestion, w: WeekId) => {
    try {
      const saved = await api.workmap.saveIdea({ ...s, id: '', departmentId: deptId, status: 'idea', note: '', weekId: w, createdAt: '', updatedAt: '' });
      setIdeas((cur) => [saved, ...cur]);
      toast('개선 목록에 담았습니다.');
    } catch (e) { toast(e instanceof Error ? e.message : '담지 못했습니다.', 'error'); }
  };

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader title="업무 분석" right={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Tab> value={tab} onChange={setTab} options={[
            { id: 'week', label: '주간 분석' }, { id: 'map', label: '4주 업무 지도' }, { id: 'ideas', label: `개선 목록${ideas.length ? ` ${ideas.length}` : ''}` },
          ]} />
          <Button tone="primary" onClick={() => setReport(true)}><FileText size={15} />대표님 보고서</Button>
        </div>
      }>
        <span className="flex items-center gap-1.5 text-[13px] text-ink-3"><Lock size={13} />관리자(admin) 계정만 보는 화면 · 매주 월요일 아침 지난주 일일보고·부서보고를 AI 컨설턴트가 부서별로 분석합니다</span>
      </PageHeader>
      {api.mode === 'demo' && <p className="-mt-4 mb-4 rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-ink-3">체험판은 정해진 견본 분석을 보여 줍니다 (공무 부서는 실제 사이트 수준의 컨설팅 분석 견본). 실제 사이트에서는 AI가 그 주에 올라온 보고를 읽고 만듭니다.</p>}
      {running.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3">
          <Spinner className="mt-0.5" />
          <div className="text-[13.5px]">
            <p className="font-bold text-brand-ink">{running.map((r) => workWeekLabel(r.weekId).replace(' 업무', '')).join(', ')} 분석 중 · 부서 {running.reduce((n, r) => n + r.done, 0)}/{running.reduce((n, r) => n + r.total, 0)}</p>
            <p className="mt-0.5 text-ink-2">AI 컨설턴트가 부서마다 보고를 꼼꼼히 읽고 있습니다. 보통 몇 분, 길면 1시간쯤 걸립니다. 이 화면을 닫아도 계속 진행되고, 끝나면 여기에 나타납니다.</p>
          </div>
        </div>
      )}
      {runs.filter((r) => r.status === 'error' && r.error).slice(0, 1).map((r) => (
        <p key={r.weekId} className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{workWeekLabel(r.weekId)} 분석 중 문제: {r.error} — [이 주 다시 분석]으로 다시 해 보세요.</p>
      ))}

      {!weeks.length ? <Empty title={running.length ? '첫 분석을 만들고 있습니다' : '아직 분석이 없습니다'} icon={<Sparkles size={22} />} /> : tab === 'week' ? (
        <WeekView all={all} weeks={weeks} week={week ?? weeks[0]} onWeek={setWeek} depts={depts} added={added} busy={running.some((r) => r.weekId === (week ?? weeks[0]))}
          onRegenerate={(w) => void regenerate(w)} onAdd={(d, s, w) => void addIdea(d, s, w)} />
      ) : tab === 'map' ? (
        <MapView all={all.filter((a) => recent.includes(a.weekId))} weeks={recent} depts={depts} added={added} onAdd={(d, s, w) => void addIdea(d, s, w)} />
      ) : (
        <IdeasView ideas={ideas} depts={depts} onChange={(i) => setIdeas((cur) => cur.map((x) => (x.id === i.id ? i : x)))} onRemove={(id) => setIdeas((cur) => cur.filter((x) => x.id !== id))} />
      )}
      {report && <ReportModal all={all.filter((a) => recent.includes(a.weekId))} weeks={recent} depts={depts} ideas={ideas} onClose={() => setReport(false)} />}
    </div>
  );
}

/* ───────────── 주간 분석 ───────────── */

function WeekView({ all, weeks, week, onWeek, depts, added, busy, onRegenerate, onAdd }: {
  all: WorkAnalysis[]; weeks: WeekId[]; week: WeekId; onWeek(w: WeekId): void; depts: Department[]; added: Set<string>; busy: boolean;
  onRegenerate(w: WeekId): void; onAdd(deptId: string, s: WorkIdeaSuggestion, w: WeekId): void;
}) {
  const [dept, setDept] = useState('');
  const list = depts.map((d) => all.find((a) => a.weekId === week && a.departmentId === d.id)).filter(Boolean) as WorkAnalysis[];
  const shown = list.filter((a) => !dept || a.departmentId === dept);
  const name = (id: string) => depts.find((d) => d.id === id)?.name ?? '';
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={week} onChange={(e) => onWeek(e.target.value)} className="!h-9 !w-auto text-[13px]" aria-label="주">
          {weeks.map((w) => <option key={w} value={w}>{workWeekLabel(w)}</option>)}
        </Select>
        <span className="text-[13px] text-ink-3">보고 {list.reduce((n, a) => n + a.reportCount, 0)}건 분석 · {list.length}개 부서</span>
        <Button size="sm" tone="ghost" className="ml-auto" disabled={busy} onClick={() => onRegenerate(week)}>{busy ? <Spinner /> : <RefreshCw size={14} />}{busy ? '분석 중…' : '이 주 다시 분석'}</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-1">
        {[{ id: '', name: '모든 부서' }, ...list.map((a) => ({ id: a.departmentId, name: name(a.departmentId) }))].map((d) => (
          <button key={d.id || 'all'} onClick={() => setDept(d.id)} className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', dept === d.id ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>{d.name}</button>
        ))}
      </div>
      <div className="space-y-4">
        {shown.map((a) => <DeptCard key={a.departmentId} a={a} name={name(a.departmentId)} added={added} onAdd={(s) => onAdd(a.departmentId, s, a.weekId)} />)}
      </div>
    </>
  );
}

function Section({ title, children, open = true, count }: { title: string; children: React.ReactNode; open?: boolean; count?: number }) {
  return (
    <details open={open} className="group mt-4 border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13.5px] font-bold text-ink-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={15} className="transition-transform group-open:rotate-90" />{title}{count != null && <span className="font-semibold text-ink-3">{count}</span>}
      </summary>
      <div className="mt-2.5">{children}</div>
    </details>
  );
}

const hours = (h?: number) => (h == null ? '' : `${Math.round(h * 10) / 10}시간`);

function DeptCard({ a, name, added, onAdd }: { a: WorkAnalysis; name: string; added: Set<string>; onAdd(s: WorkIdeaSuggestion): void }) {
  const max = Math.max(1, ...a.categories.map((c) => c.count));
  const rich = !!a.tasks?.length;
  const ideas = a.ideas.filter((s) => s.level !== 'human');
  const humanIdeas = a.ideas.filter((s) => s.level === 'human');
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-bold">{name}</h3>
        <Badge>보고 {a.reportCount}건</Badge>
        {a.replaceRate != null && <Badge tone="brand">AI 대체 가능 약 {a.replaceRate}%</Badge>}
        {a.hoursSavable != null && <Badge tone="ok">절감 가능 주 {hours(a.hoursSavable)}{a.hoursObserved ? ` / 확인된 업무 ${hours(a.hoursObserved)}` : ''}</Badge>}
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{a.summary}</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[13px] font-bold text-ink-2">업무 구성 {rich ? '(시간 비중)' : '(나온 횟수)'}</p>
          <ul className="space-y-2">
            {a.categories.map((c) => (
              <li key={c.name}>
                <div className="flex items-center gap-2 text-[13.5px]"><span className="w-28 shrink-0 truncate font-semibold">{c.name}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-brand" style={{ width: `${c.share != null ? c.share : (c.count / max) * 100}%` }} /></span>
                  <span className="w-12 shrink-0 text-right text-[12.5px] font-semibold text-ink-2">{c.share != null ? `${c.share}%` : c.count}</span>
                </div>
                <p className="mt-0.5 truncate pl-[7.5rem] text-[12px] text-ink-3">{c.examples.join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-bold text-ink-2">반복되는 일</p>
          {!a.recurring.length ? <p className="text-[13px] text-ink-3">이번 주에 반복된 일은 없습니다.</p> : (
            <ul className="space-y-2">
              {a.recurring.map((r) => (
                <li key={r.task} className="rounded-lg bg-sunken/60 px-3 py-2">
                  <p className="flex items-center gap-2 text-[13.5px] font-semibold">{r.task}<span className="ml-auto shrink-0 text-[12px] font-semibold text-brand-ink">이번 주 {r.times}번</span></p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">{r.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {!!a.tasks?.length && (
        <Section title="업무 목록과 AI 대체 가능성" count={a.tasks.length} open={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-[13px]">
              <thead><tr className="border-b border-line text-[12px] text-ink-3"><th className="py-1.5 pr-2 font-semibold">업무</th><th className="px-2 font-semibold">횟수</th><th className="px-2 font-semibold">주간 시간</th><th className="px-2 font-semibold">도구 · 산출물</th><th className="px-2 font-semibold">AI 대체 가능성</th></tr></thead>
              <tbody>
                {[...a.tasks].sort((x, y) => y.score - x.score).map((t) => (
                  <tr key={t.task} className="border-b border-line/60 align-top">
                    <td className="py-2 pr-2"><p className="font-semibold">{t.task}</p><p className="mt-0.5 text-[12px] text-ink-3">{t.evidence}</p></td>
                    <td className="px-2 py-2">{t.times}</td>
                    <td className="whitespace-nowrap px-2 py-2">{hours(t.hoursPerWeek)}</td>
                    <td className="px-2 py-2 text-[12.5px] text-ink-2">{t.tools.join(', ')}<br /><span className="text-ink-3">{t.output}</span></td>
                    <td className="w-56 px-2 py-2">
                      <div className="flex items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken"><span className={cx('block h-full rounded-full', t.replaceability === 'full' ? 'bg-brand' : t.replaceability === 'partial' ? 'bg-ok' : 'bg-ink-3')} style={{ width: `${t.score}%` }} /></span><span className="w-9 text-right text-[12px] font-semibold">{t.score}</span></div>
                      <p className="mt-1 text-[12px] font-semibold">{REPLACE_LABEL[t.replaceability]}</p>
                      <p className="text-[12px] text-ink-3">{t.reason}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {!!a.issues?.length && (
        <Section title="문제점·비효율" count={a.issues.length}>
          <ul className="space-y-2">
            {a.issues.map((x) => (
              <li key={x.finding} className="rounded-lg border-l-4 border-warn bg-warn/5 px-3 py-2">
                <p className="text-[13.5px] font-semibold">{x.finding}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">근거: {x.evidence}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-2">영향: {x.impact}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={rich ? '개선안 (효과가 큰 순서)' : 'AI 활용 후보'} count={ideas.length}>
        <ul className="space-y-3">
          {ideas.map((s, i) => <IdeaCard key={s.title ?? s.task} n={i + 1} s={s} added={added.has(ideaKey(a.departmentId, s.task))} onAdd={() => onAdd(s)} />)}
        </ul>
      </Section>

      {(!!a.humanTasks?.length || !!humanIdeas.length) && (
        <Section title="사람이 계속 해야 하는 일" open={false}>
          <ul className="space-y-1 text-[13px]">
            {(a.humanTasks ?? humanIdeas.map((h) => ({ task: h.task, reason: h.how }))).map((h) => <li key={h.task}><b>{h.task}</b> — <span className="text-ink-2">{h.reason}</span></li>)}
          </ul>
        </Section>
      )}
      {!!a.ceoPoints?.length && (
        <Section title="대표님 보고·결정 포인트" count={a.ceoPoints.length}>
          <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{a.ceoPoints.map((p) => <li key={p}>{p}</li>)}</ul>
        </Section>
      )}
      {!!a.questions?.length && (
        <Section title="부서에 확인할 질문" count={a.questions.length} open={false}>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-2">{a.questions.map((q) => <li key={q}>{q}</li>)}</ul>
        </Section>
      )}
    </Card>
  );
}

/** 개선안 한 장: 지금 → 바뀐 뒤, 방법, 시스템 설계·프롬프트, 실행 단계, 기대효과 */
function IdeaCard({ s, n, added, onAdd, dept }: { s: WorkIdeaSuggestion; n?: number; added: boolean; onAdd(): void; dept?: string }) {
  const { toast } = useStore();
  const rich = !!(s.asIs || s.toBe);
  return (
    <li className="rounded-xl border border-line p-3.5">
      <div className="flex flex-wrap items-start gap-2">
        {n != null && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12.5px] font-bold text-brand-ink">{n}</span>}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge tone={levelTone(s.level)}>{LEVEL_LABEL[s.level]}</Badge>
            {s.approach && <Badge tone="note">{APPROACH_LABEL[s.approach]}</Badge>}
            {dept && <span className="text-[12.5px] font-semibold text-ink-3">{dept}</span>}
            <span className="text-[14.5px] font-bold">{s.title || s.task}</span>
          </p>
          {s.title && <p className="mt-0.5 text-[12.5px] text-ink-3">대상 업무: {s.task}</p>}
        </div>
        {added
          ? <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-ok"><Check size={14} />개선 목록에 있음</span>
          : <Button size="sm" className="shrink-0" onClick={onAdd}><Plus size={14} />개선 목록에 담기</Button>}
      </div>
      {rich && (
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-sunken/70 px-3 py-2"><p className="text-[11.5px] font-bold text-ink-3">지금</p><p className="mt-0.5 text-[13px] leading-relaxed">{s.asIs}</p></div>
          <div className="rounded-lg bg-brand-soft/70 px-3 py-2"><p className="text-[11.5px] font-bold text-brand-ink">바뀐 뒤</p><p className="mt-0.5 text-[13px] leading-relaxed">{s.toBe}</p></div>
        </div>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{s.how}</p>
      {s.system && <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-sunken/50 px-3 py-2 text-[12.5px] leading-relaxed"><Wrench size={13} className="mt-0.5 shrink-0 text-brand-ink" /><span><b className="text-brand-ink">{rich ? '시스템 설계' : '시스템에 붙인다면'}</b> {s.system}</span></p>}
      {s.toolPrompt && (
        <div className="mt-1.5 rounded-lg border border-line bg-surface px-3 py-2">
          <p className="flex items-center gap-1 text-[12px] font-bold text-ink-3">바로 쓰는 프롬프트
            <button className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-ink hover:bg-sunken" onClick={() => void navigator.clipboard?.writeText(s.toolPrompt!).then(() => toast('프롬프트를 복사했습니다.'))}><Copy size={12} />복사</button>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">{s.toolPrompt}</p>
        </div>
      )}
      {!!s.steps?.length && (
        <div className="mt-2"><p className="text-[12px] font-bold text-ink-3">실행 단계</p><ol className="mt-0.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-ink-2">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol></div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {s.hoursSaved != null && <span><b className="text-ok">주 {hours(s.hoursSaved)} 절감</b>{s.savingsBasis ? ` (${s.savingsBasis})` : ''}</span>}
        {s.errorReduction && <span>실수 감소: {s.errorReduction}</span>}
        <span>효과 {GRADE_LABEL[s.impact]} · 만들기 어려움 {GRADE_LABEL[s.effort]}</span>
        {s.kpi && <span>성과 지표: {s.kpi}</span>}
        {s.risks && <span>주의: {s.risks}</span>}
      </div>
    </li>
  );
}

/* ───────────── 4주 업무 지도 ───────────── */

interface Ranked { deptId: string; s: WorkIdeaSuggestion; times: number; score: number; weekId: WeekId }

function rankIdeas(all: WorkAnalysis[]): Ranked[] {
  const m = new Map<string, Ranked>();
  for (const a of all) {
    for (const s of a.ideas) {
      if (s.level === 'human') continue;
      const k = ideaKey(a.departmentId, s.task);
      const t = a.recurring.find((r) => r.task === s.task)?.times ?? 1;
      const cur = m.get(k);
      if (cur) { cur.times += t; if (a.weekId > cur.weekId) { cur.s = s; cur.weekId = a.weekId; } } else m.set(k, { deptId: a.departmentId, s, times: t, score: 0, weekId: a.weekId });
    }
  }
  return [...m.values()].map((r) => ({ ...r, score: ideaScore(r.s, r.times) })).sort((a, b) => b.score - a.score);
}

function MapView({ all, weeks, depts, added, onAdd }: { all: WorkAnalysis[]; weeks: WeekId[]; depts: Department[]; added: Set<string>; onAdd(deptId: string, s: WorkIdeaSuggestion, w: WeekId): void }) {
  const name = (id: string) => depts.find((d) => d.id === id)?.name ?? '';
  const rows = depts.map((d) => {
    const xs = all.filter((a) => a.departmentId === d.id);
    const cats = new Map<string, number>();
    xs.forEach((a) => a.categories.forEach((c) => cats.set(c.name, (cats.get(c.name) ?? 0) + (c.share ?? c.count))));
    const rec = new Map<string, number>();
    xs.forEach((a) => a.recurring.forEach((r) => rec.set(r.task, (rec.get(r.task) ?? 0) + r.times)));
    const latest = [...xs].sort((x, y) => y.weekId.localeCompare(x.weekId)).find((a) => a.replaceRate != null);
    return { d, latest, reports: xs.reduce((n, a) => n + a.reportCount, 0), cats: [...cats.entries()].sort((a, b) => b[1] - a[1]), rec: [...rec.entries()].sort((a, b) => b[1] - a[1]) };
  }).filter((r) => r.reports);
  const ranked = rankIdeas(all).slice(0, 10);
  const palette = ['bg-brand', 'bg-[#5b8def]', 'bg-[#43a58a]', 'bg-[#e0a03b]', 'bg-[#a77bd6]', 'bg-ink-3'];
  const first = weeks[weeks.length - 1];
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h3 className="text-[16px] font-bold">부서별로 실제 하는 일</h3>
        <p className="mb-4 mt-0.5 text-[12.5px] text-ink-3">{first ? workWeekLabel(first).replace(/~.*/, '') : ''} ~ {weeks[0] ? workWeekLabel(weeks[0]).replace(/^.*~/, '').replace(' 업무', '') : ''} · 최근 {weeks.length}주 보고에서 나온 횟수</p>
        <div className="space-y-4">
          {rows.map(({ d, latest, reports, cats, rec }) => {
            const total = cats.reduce((n, c) => n + c[1], 0) || 1;
            return (
              <div key={d.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2"><p className="text-[14px] font-bold">{d.name}</p><span className="text-[12px] text-ink-3">보고 {reports}건</span>
                  {latest?.replaceRate != null && <Badge tone="brand">AI 대체 약 {latest.replaceRate}%</Badge>}
                  {latest?.hoursSavable != null && <Badge tone="ok">주 {hours(latest.hoursSavable)} 절감 가능</Badge>}
                  <span className="ml-auto hidden truncate text-[12px] text-ink-3 sm:block">자주 반복: {rec.slice(0, 2).map(([t, n]) => `${t} ${n}번`).join(', ')}</span></div>
                <div className="flex h-6 overflow-hidden rounded-md">
                  {cats.map(([c, n], i) => (
                    <span key={c} title={`${c} ${n}`} className={cx('flex items-center overflow-hidden whitespace-nowrap px-1.5 text-[11.5px] font-semibold text-white', palette[i % palette.length])} style={{ width: `${(n / total) * 100}%` }}>
                      {n / total > 0.12 ? `${c} ${Math.round((n / total) * 100)}%` : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-1 text-[12px] text-ink-3 sm:hidden">자주 반복: {rec.slice(0, 2).map(([t, n]) => `${t} ${n}번`).join(', ')}</p>
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="flex items-center gap-1.5 text-[16px] font-bold"><Sparkles size={16} className="text-brand-ink" />AI로 바꾸기 좋은 순서</h3>
        <p className="mb-3 mt-0.5 text-[12.5px] text-ink-3">자주 반복되고, AI가 대신할 수 있고, 효과는 크면서 만들기 쉬운 것부터</p>
        {!ranked.length ? <Empty title="후보가 없습니다" /> : (
          <ul className="space-y-3">
            {ranked.map((r, i) => <IdeaCard key={ideaKey(r.deptId, r.s.task)} n={i + 1} dept={name(r.deptId)} s={r.s} added={added.has(ideaKey(r.deptId, r.s.task))} onAdd={() => onAdd(r.deptId, r.s, r.weekId)} />)}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ───────────── 개선 목록 ───────────── */

function IdeasView({ ideas, depts, onChange, onRemove }: { ideas: WorkIdea[]; depts: Department[]; onChange(i: WorkIdea): void; onRemove(id: string): void }) {
  const { toast } = useStore();
  const [status, setStatus] = useState<IdeaStatus | 'all'>('all');
  const name = (id: string) => depts.find((d) => d.id === id)?.name ?? '';
  const list = ideas.filter((i) => status === 'all' || i.status === status);
  const save = async (i: WorkIdea) => {
    onChange(i);
    try { onChange(await api.workmap.saveIdea(i)); } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); }
  };
  if (!ideas.length) return <Empty title="개선 목록이 비어 있습니다" icon={<Wrench size={22} />}>주간 분석이나 업무 지도에서 [개선 목록에 담기]를 누르면 여기에 모입니다.</Empty>;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1">
        {[{ id: 'all' as const, label: '전체' }, ...IDEA_STATUS].map((s) => {
          const n = s.id === 'all' ? ideas.length : ideas.filter((i) => i.status === s.id).length;
          return <button key={s.id} onClick={() => setStatus(s.id)} className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', status === s.id ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>{s.label} {n}</button>;
        })}
      </div>
      <div className="space-y-3">
        {list.map((i) => (
          <Card key={i.id} className="p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={levelTone(i.level)}>{LEVEL_LABEL[i.level]}</Badge>
              <span className="text-[12.5px] font-semibold text-ink-3">{name(i.departmentId)}</span>
              <span className="text-[15px] font-bold">{i.title || i.task}</span>
              {i.hoursSaved != null && <Badge tone="ok">주 {hours(i.hoursSaved)} 절감</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Select value={i.status} onChange={(e) => void save({ ...i, status: e.target.value as IdeaStatus })} className="!h-8 !w-auto text-[13px]" aria-label="진행 상태">
                  {IDEA_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
                <button aria-label="목록에서 빼기" onClick={() => { if (confirm('개선 목록에서 뺄까요?')) void api.workmap.removeIdea(i.id).then(() => onRemove(i.id)).catch((e) => toast(e.message, 'error')); }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-danger"><Trash2 size={15} /></button>
              </div>
            </div>
            {i.title && <p className="mt-0.5 text-[12.5px] text-ink-3">대상 업무: {i.task}</p>}
            {(i.asIs || i.toBe) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-sunken/70 px-3 py-2"><p className="text-[11.5px] font-bold text-ink-3">지금</p><p className="mt-0.5 text-[13px]">{i.asIs}</p></div>
                <div className="rounded-lg bg-brand-soft/70 px-3 py-2"><p className="text-[11.5px] font-bold text-brand-ink">바뀐 뒤</p><p className="mt-0.5 text-[13px]">{i.toBe}</p></div>
              </div>
            )}
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{i.how}</p>
            {!!i.steps?.length && <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] text-ink-2">{i.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
            {i.kpi && <p className="mt-1 text-[12px] text-ink-3">성과 지표: {i.kpi}</p>}
            {i.system && <p className="mt-1 flex items-start gap-1.5 text-[12.5px] font-semibold text-brand-ink"><Wrench size={13} className="mt-0.5 shrink-0" />시스템에 붙인다면: {i.system}</p>}
            <NoteInput value={i.note} onSave={(note) => void save({ ...i, note })} />
          </Card>
        ))}
      </div>
    </>
  );
}

function NoteInput({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} placeholder="메모 (예: 다음 달 시범 적용, 견적부 김 과장과 협의)" className="mt-2 !h-9 text-[13px]" />;
}

/* ───────────── 대표님 보고서 ───────────── */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function reportHtml(all: WorkAnalysis[], weeks: WeekId[], depts: Department[], ideas: WorkIdea[]): string {
  const name = (id: string) => depts.find((d) => d.id === id)?.name ?? '';
  const latest = weeks[0];
  const period = weeks.length ? `${workWeekLabel(weeks[weeks.length - 1]).replace(/~.*/, '')} ~ ${workWeekLabel(latest).replace(/^.*~/, '').replace(' 업무', '')}` : '';
  const ranked = rankIdeas(all).slice(0, 5);
  const reports = all.reduce((n, a) => n + a.reportCount, 0);
  const latestByDept = depts.map((d) => all.filter((a) => a.departmentId === d.id).sort((x, y) => y.weekId.localeCompare(x.weekId))[0]).filter(Boolean);
  const totalSave = Math.round(latestByDept.reduce((n, a) => n + (a!.hoursSavable ?? 0), 0) * 10) / 10;
  const deptRows = depts.map((d) => {
    const xs = all.filter((a) => a.departmentId === d.id);
    if (!xs.length) return '';
    const cur = xs.find((a) => a.weekId === latest) ?? xs[0];
    const cats = new Map<string, number>();
    xs.forEach((a) => a.categories.forEach((c) => cats.set(c.name, (cats.get(c.name) ?? 0) + c.count)));
    const total = [...cats.values()].reduce((n, v) => n + v, 0) || 1;
    const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${esc(c)} ${Math.round((n / total) * 100)}%`).join(' · ');
    const best = rankIdeas(xs).slice(0, 2).map((r) => `<li><b>${esc(r.s.title || r.s.task)}</b>${r.s.hoursSaved != null ? ` <span class="ok">주 ${r.s.hoursSaved}시간 절감</span>` : ''} — ${esc(r.s.toBe || r.s.how)}</li>`).join('');
    const metrics = cur.replaceRate != null ? `<p class="kpi">AI 대체 가능 약 <b>${cur.replaceRate}%</b>${cur.hoursSavable != null ? ` · 절감 가능 주 <b>${cur.hoursSavable}시간</b>` : ''}${cur.hoursObserved ? ` (확인된 업무 주 ${cur.hoursObserved}시간)` : ''}</p>` : '';
    const issues = (cur.issues ?? []).slice(0, 2).map((x) => `<li>${esc(x.finding)} <span class="mut">— ${esc(x.impact)}</span></li>`).join('');
    const ceo = (cur.ceoPoints ?? []).map((x) => `<li>${esc(x)}</li>`).join('');
    return `<section><h3>${esc(d.name)}</h3><p class="mut">${top}</p>${metrics}<p>${esc(cur.summary)}</p>${issues ? `<p class="lbl">문제점</p><ul>${issues}</ul>` : ''}${best ? `<p class="lbl">먼저 할 개선</p><ul>${best}</ul>` : ''}${ceo ? `<p class="lbl">보고·결정 포인트</p><ul>${ceo}</ul>` : ''}</section>`;
  }).join('');
  const counts = IDEA_STATUS.map((s) => `${s.label} ${ideas.filter((i) => i.status === s.id).length}건`).join(' · ');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>부서 업무 분석 보고</title><style>
    body{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1d2430;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.6;font-size:14px}
    h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #1d2430;padding-bottom:4px}h3{font-size:15px;margin:18px 0 2px}
    .mut{color:#6b7380;font-size:12.5px;margin:2px 0}ol,ul{padding-left:20px;margin:6px 0}li{margin:4px 0}.tag{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:9px;background:#e8eefb;color:#2856b8;margin-right:4px}.tag.g{background:#f1ecfa;color:#6a3fb0}.ok{color:#1f8a5b;font-weight:700}.kpi{background:#f4f7fb;border-radius:8px;padding:8px 12px}.lbl{font-weight:700;font-size:13px;margin:8px 0 0}
    section{page-break-inside:avoid}@media print{body{margin:0}}
  </style></head><body>
    <h1>부서 업무 분석 보고</h1>
    <p class="mut">대상 기간 ${esc(period)} (최근 ${weeks.length}주) · 분석한 보고 ${reports}건 · ${new Date().toLocaleDateString('ko-KR')} 작성</p>
    <h2>요약: AI로 먼저 바꿀 만한 일 ${ranked.length}가지</h2>
    ${totalSave ? `<p class="kpi">부서별 개선안을 모두 적용하면 <b>주 약 ${totalSave}시간</b>(월 약 ${Math.round(totalSave * 4.3)}시간)을 줄일 수 있는 것으로 추정됩니다.</p>` : ''}
    <ol>${ranked.map((r) => `<li><span class="tag">${LEVEL_LABEL[r.s.level]}</span>${r.s.approach ? `<span class="tag g">${APPROACH_LABEL[r.s.approach]}</span>` : ''}<b>${esc(name(r.deptId))} · ${esc(r.s.title || r.s.task)}</b>${r.s.hoursSaved != null ? ` <span class="ok">주 ${r.s.hoursSaved}시간 절감</span>` : ''}<br>${r.s.asIs ? `지금: ${esc(r.s.asIs)}<br>바뀐 뒤: ${esc(r.s.toBe ?? '')}` : esc(r.s.how)}${r.s.savingsBasis ? `<br><span class="mut">근거: ${esc(r.s.savingsBasis)}</span>` : ''}<br><span class="mut">효과 ${GRADE_LABEL[r.s.impact]} · 난이도 ${GRADE_LABEL[r.s.effort]}${r.s.kpi ? ` · 성과 지표: ${esc(r.s.kpi)}` : ''}</span></li>`).join('')}</ol>
    <h2>부서별 업무 구성</h2>${deptRows}
    <h2>개선 진행 현황</h2><p>${counts}</p>
    ${ideas.length ? `<ul>${ideas.map((i) => `<li>[${IDEA_STATUS.find((s) => s.id === i.status)?.label}] ${esc(name(i.departmentId))} · ${esc(i.task)}${i.note ? ` — ${esc(i.note)}` : ''}</li>`).join('')}</ul>` : ''}
    <p class="mut" style="margin-top:28px">※ 일일보고·주간 부서보고에 적힌 내용만으로 분석했습니다. 업무 시간은 보고에 없어 '나온 횟수'를 기준으로 했습니다. 개인이 아니라 부서 단위 분석입니다.</p>
  </body></html>`;
}

function ReportModal({ all, weeks, depts, ideas, onClose }: { all: WorkAnalysis[]; weeks: WeekId[]; depts: Department[]; ideas: WorkIdea[]; onClose(): void }) {
  const html = useMemo(() => reportHtml(all, weeks, depts, ideas), [all, weeks, depts, ideas]);
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };
  return (
    <Modal open onClose={onClose} title="대표님 보고서" width={860}
      footer={<><Button onClick={onClose}>닫기</Button><Button tone="primary" onClick={print}><Printer size={15} />인쇄·PDF로 저장</Button></>}>
      <p className="mb-2 text-[12.5px] text-ink-3">최근 {weeks.length}주 분석과 개선 목록으로 만든 보고서입니다. [인쇄·PDF로 저장]에서 'PDF로 저장'을 고르면 파일로 받을 수 있습니다.</p>
      <iframe title="보고서 미리보기" srcDoc={html} className="h-[60vh] w-full rounded-lg border border-line bg-white" />
    </Modal>
  );
}
