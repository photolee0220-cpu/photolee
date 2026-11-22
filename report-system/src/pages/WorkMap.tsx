import { Check, FileText, Lock, Plus, Printer, RefreshCw, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, Card, cx, Empty, Input, Modal, Segmented, Select, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { activeDepartments } from '../lib/derive';
import type { Department, WeekId } from '../lib/types';
import { parseIsoDate, shiftDay } from '../lib/week';
import {
  GRADE_LABEL, IDEA_STATUS, LEVEL_LABEL, ideaScore, isOwner,
  type IdeaLevel, type IdeaStatus, type WorkAnalysis, type WorkIdea, type WorkIdeaSuggestion,
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
  const [ideas, setIdeas] = useState<WorkIdea[]>([]);
  const [week, setWeek] = useState<WeekId | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const depts = useMemo(() => (snap ? activeDepartments(snap) : []), [snap]);

  useEffect(() => {
    if (!isOwner(me)) return;
    api.workmap.list().then((x) => { setAll(x); setWeek((w) => w ?? x[0]?.weekId ?? null); }).catch((e) => { setAll([]); toast(e instanceof Error ? e.message : '분석을 불러오지 못했습니다.', 'error'); });
    api.workmap.ideas().then(setIdeas).catch(() => undefined);
  }, [me, toast]);

  if (!isOwner(me)) return <Empty title="관리자(admin) 계정만 볼 수 있는 화면입니다" icon={<Lock size={22} />} />;
  if (!all) return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <Spinner />
      <p className="text-[13.5px] text-ink-3">분석을 불러오는 중입니다.<br />처음 여는 때에는 최근 4주 보고를 AI가 분석하느라 1~2분쯤 걸립니다.</p>
    </div>
  );

  const weeks = [...new Set(all.map((a) => a.weekId))].sort().reverse();
  const recent = weeks.slice(0, 4);
  const added = new Set(ideas.map((i) => ideaKey(i.departmentId, i.task)));
  const regenerate = async (w: WeekId) => {
    setBusy(true);
    try {
      const fresh = await api.workmap.generate(w);
      setAll((cur) => [...(cur ?? []).filter((x) => x.weekId !== w), ...fresh]);
      toast('다시 분석했습니다.');
    } catch (e) { toast(e instanceof Error ? e.message : '분석하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  const addIdea = async (deptId: string, s: WorkIdeaSuggestion, w: WeekId) => {
    try {
      const saved = await api.workmap.saveIdea({ id: '', departmentId: deptId, task: s.task, level: s.level, how: s.how, system: s.system, effort: s.effort, impact: s.impact,
        status: 'idea', note: '', weekId: w, createdAt: '', updatedAt: '' });
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
        <span className="flex items-center gap-1.5 text-[13px] text-ink-3"><Lock size={13} />관리자(admin) 계정만 보는 화면 · 매주 월요일 아침 지난주 일일보고·부서보고를 AI가 부서별로 정리합니다</span>
      </PageHeader>
      {api.mode === 'demo' && <p className="-mt-4 mb-4 rounded-lg bg-sunken px-3 py-2 text-[12.5px] text-ink-3">체험판은 정해진 견본 분석을 보여 줍니다. 실제 사이트에서는 AI가 그 주에 올라온 보고를 읽고 만듭니다.</p>}

      {!weeks.length ? <Empty title="아직 분석이 없습니다" icon={<Sparkles size={22} />} /> : tab === 'week' ? (
        <WeekView all={all} weeks={weeks} week={week ?? weeks[0]} onWeek={setWeek} depts={depts} added={added} busy={busy}
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
        <Button size="sm" tone="ghost" className="ml-auto" disabled={busy} onClick={() => onRegenerate(week)}>{busy ? <Spinner /> : <RefreshCw size={14} />}{busy ? '분석 중… (1분쯤)' : '이 주 다시 분석'}</Button>
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

function DeptCard({ a, name, added, onAdd }: { a: WorkAnalysis; name: string; added: Set<string>; onAdd(s: WorkIdeaSuggestion): void }) {
  const max = Math.max(1, ...a.categories.map((c) => c.count));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[17px] font-bold">{name}</h3>
        <Badge>보고 {a.reportCount}건</Badge>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{a.summary}</p>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-2 text-[13px] font-bold text-ink-2">하는 일 (나온 횟수)</p>
          <ul className="space-y-2">
            {a.categories.map((c) => (
              <li key={c.name}>
                <div className="flex items-center gap-2 text-[13.5px]"><span className="w-28 shrink-0 truncate font-semibold">{c.name}</span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full bg-brand" style={{ width: `${(c.count / max) * 100}%` }} /></span>
                  <span className="w-8 shrink-0 text-right text-[12.5px] font-semibold text-ink-2">{c.count}</span>
                </div>
                <p className="mt-0.5 truncate pl-[7.5rem] text-[12px] text-ink-3">{c.examples.join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-bold text-ink-2">반복되는 일</p>
          <ul className="space-y-2">
            {a.recurring.map((r) => (
              <li key={r.task} className="rounded-lg bg-sunken/60 px-3 py-2">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold">{r.task}<span className="ml-auto shrink-0 text-[12px] font-semibold text-brand-ink">이번 주 {r.times}번</span></p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{r.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mb-2 mt-5 flex items-center gap-1.5 text-[13px] font-bold text-ink-2"><Sparkles size={14} className="text-brand-ink" />AI 활용 후보</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {a.ideas.map((s) => <IdeaRow key={s.task} s={s} added={added.has(ideaKey(a.departmentId, s.task))} onAdd={() => onAdd(s)} />)}
      </ul>
    </Card>
  );
}

function IdeaRow({ s, added, onAdd, rank, dept }: { s: WorkIdeaSuggestion; added: boolean; onAdd(): void; rank?: number; dept?: string }) {
  const human = s.level === 'human';
  return (
    <li className={cx('flex flex-col gap-2 px-3.5 py-3 sm:flex-row sm:items-start', human && 'opacity-60')}>
      {rank != null && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-bold text-brand-ink">{rank}</span>}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <Badge tone={levelTone(s.level)}>{LEVEL_LABEL[s.level]}</Badge>
          {dept && <span className="text-[12.5px] font-semibold text-ink-3">{dept}</span>}
          <span className="text-[14px] font-bold">{s.task}</span>
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{s.how}</p>
        {!human && s.system && <p className="mt-1 flex items-start gap-1.5 text-[12.5px] font-semibold text-brand-ink"><Wrench size={13} className="mt-0.5 shrink-0" />시스템에 붙인다면: {s.system}</p>}
        {!human && <p className="mt-1 text-[12px] text-ink-3">효과 {GRADE_LABEL[s.impact]} · 만들기 어려움 {GRADE_LABEL[s.effort]}</p>}
      </div>
      {!human && (added
        ? <span className="flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-ok"><Check size={14} />개선 목록에 있음</span>
        : <Button size="sm" className="shrink-0" onClick={onAdd}><Plus size={14} />개선 목록에 담기</Button>)}
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
    xs.forEach((a) => a.categories.forEach((c) => cats.set(c.name, (cats.get(c.name) ?? 0) + c.count)));
    const rec = new Map<string, number>();
    xs.forEach((a) => a.recurring.forEach((r) => rec.set(r.task, (rec.get(r.task) ?? 0) + r.times)));
    return { d, reports: xs.reduce((n, a) => n + a.reportCount, 0), cats: [...cats.entries()].sort((a, b) => b[1] - a[1]), rec: [...rec.entries()].sort((a, b) => b[1] - a[1]) };
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
          {rows.map(({ d, reports, cats, rec }) => {
            const total = cats.reduce((n, c) => n + c[1], 0) || 1;
            return (
              <div key={d.id}>
                <div className="mb-1 flex items-center gap-2"><p className="text-[14px] font-bold">{d.name}</p><span className="text-[12px] text-ink-3">보고 {reports}건</span>
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
          <ul className="divide-y divide-line rounded-xl border border-line">
            {ranked.map((r, i) => <IdeaRow key={ideaKey(r.deptId, r.s.task)} rank={i + 1} dept={name(r.deptId)} s={r.s} added={added.has(ideaKey(r.deptId, r.s.task))} onAdd={() => onAdd(r.deptId, r.s, r.weekId)} />)}
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
              <span className="text-[15px] font-bold">{i.task}</span>
              <div className="ml-auto flex items-center gap-1">
                <Select value={i.status} onChange={(e) => void save({ ...i, status: e.target.value as IdeaStatus })} className="!h-8 !w-auto text-[13px]" aria-label="진행 상태">
                  {IDEA_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
                <button aria-label="목록에서 빼기" onClick={() => { if (confirm('개선 목록에서 뺄까요?')) void api.workmap.removeIdea(i.id).then(() => onRemove(i.id)).catch((e) => toast(e.message, 'error')); }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-danger"><Trash2 size={15} /></button>
              </div>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{i.how}</p>
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
  const deptRows = depts.map((d) => {
    const xs = all.filter((a) => a.departmentId === d.id);
    if (!xs.length) return '';
    const cur = xs.find((a) => a.weekId === latest) ?? xs[0];
    const cats = new Map<string, number>();
    xs.forEach((a) => a.categories.forEach((c) => cats.set(c.name, (cats.get(c.name) ?? 0) + c.count)));
    const total = [...cats.values()].reduce((n, v) => n + v, 0) || 1;
    const top = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${esc(c)} ${Math.round((n / total) * 100)}%`).join(' · ');
    const best = rankIdeas(xs).slice(0, 2).map((r) => `<li><b>${esc(r.s.task)}</b> — ${esc(r.s.how)}</li>`).join('');
    return `<section><h3>${esc(d.name)}</h3><p class="mut">${top}</p><p>${esc(cur.summary)}</p>${best ? `<ul>${best}</ul>` : ''}</section>`;
  }).join('');
  const counts = IDEA_STATUS.map((s) => `${s.label} ${ideas.filter((i) => i.status === s.id).length}건`).join(' · ');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>부서 업무 분석 보고</title><style>
    body{font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1d2430;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.6;font-size:14px}
    h1{font-size:22px;margin:0}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #1d2430;padding-bottom:4px}h3{font-size:15px;margin:18px 0 2px}
    .mut{color:#6b7380;font-size:12.5px;margin:2px 0}ol,ul{padding-left:20px;margin:6px 0}li{margin:4px 0}.tag{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:9px;background:#e8eefb;color:#2856b8;margin-right:4px}
    section{page-break-inside:avoid}@media print{body{margin:0}}
  </style></head><body>
    <h1>부서 업무 분석 보고</h1>
    <p class="mut">대상 기간 ${esc(period)} (최근 ${weeks.length}주) · 분석한 보고 ${reports}건 · ${new Date().toLocaleDateString('ko-KR')} 작성</p>
    <h2>요약: AI로 먼저 바꿀 만한 일 ${ranked.length}가지</h2>
    <ol>${ranked.map((r) => `<li><span class="tag">${LEVEL_LABEL[r.s.level]}</span><b>${esc(name(r.deptId))} · ${esc(r.s.task)}</b><br>${esc(r.s.how)}${r.s.system ? `<br><span class="mut">시스템 적용안: ${esc(r.s.system)} (효과 ${GRADE_LABEL[r.s.impact]}, 난이도 ${GRADE_LABEL[r.s.effort]})</span>` : ''}</li>`).join('')}</ol>
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
