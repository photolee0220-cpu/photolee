import { ChevronLeft, ChevronRight, Expand, Lock, Minimize, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Logo } from '../components/AppShell';
import { changeCount, DiffText } from '../components/DiffText';
import { dueInfo, isImminent } from '../components/SiteCard';
import { Badge, cx, Progress, StageChip, Toggle } from '../components/ui';
import { canViewDept } from '../lib/access';
import { api } from '../lib/client';
import {
  activeDirectives, has, hasWritten, memberDirective, personEntry, reporters, siteDepartments, siteDirective, siteEntry, siteStatusOf, visibleSites,
} from '../lib/derive';
import { DIRECTIVE_STATUS, type AiSummary, type Directive, type Member, type Site } from '../lib/types';
import { weekLabelLong } from '../lib/week';
import { useStore } from '../state/store';

type Slide = { kind: 'cover' } | { kind: 'site'; site: Site } | { kind: 'person'; member: Member };

/** 월요일 회의용 전체 화면: 현장 한 곳씩, 이어서 부서 업무보고를 크게 넘겨 본다 */
export function MeetingView({ onClose }: { onClose(): void }) {
  const { snap, me, weekId } = useStore();
  const [changedOnly, setChangedOnly] = useState(false);
  const [withPeople, setWithPeople] = useState(true);
  const [index, setIndex] = useState(0);
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => { if (me.isCeo) api.getAiSummary(weekId).then(setSummary).catch(() => undefined); }, [me.isCeo, weekId]);

  const slides = useMemo<Slide[]>(() => {
    if (!snap) return [];
    const depts = siteDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants));
    const changed = (s: Site) => !snap.prevWeekId
      || depts.some((d) => changeCount(siteEntry(snap.entries, s.id, d.id)?.content, siteEntry(snap.prevEntries, s.id, d.id)?.content) > 0)
      || changeCount(siteDirective(snap.directives, s.id)?.content, siteDirective(snap.prevDirectives, s.id)?.content) > 0;
    const sites = snap.stages.flatMap((st) => visibleSites(snap).filter((s) => s.stage === st.id && (!changedOnly || changed(s))));
    const people = withPeople ? reporters(snap).filter((m) => canViewDept(me, m.departmentId, snap.grants) && has(personEntry(snap.entries, m.id)?.content)) : [];
    return [{ kind: 'cover' }, ...sites.map((site) => ({ kind: 'site' as const, site })), ...people.map((member) => ({ kind: 'person' as const, member }))];
  }, [snap, me, changedOnly, withPeople]);

  const last = slides.length - 1;
  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(last, i))), [last]);
  useEffect(() => { if (index > last) setIndex(Math.max(0, last)); }, [index, last]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(index + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
      if (e.key === 'Home') go(0);
      if (e.key === 'End') go(last);
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, last, go, onClose]);
  useEffect(() => {
    const h = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  if (!snap) return null;
  const slide = slides[index] ?? slides[0];
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-bg" role="dialog" aria-label="회의 화면">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
        <Logo size={30} />
        <p className="font-bold">주간 회의 <span className="font-medium text-ink-3">· {weekLabelLong(weekId)}</span></p>
        <div className="ml-auto flex flex-wrap items-center gap-4 text-[13px]">
          <Toggle checked={changedOnly} onChange={setChangedOnly} label="바뀐 현장만" />
          <Toggle checked={withPeople} onChange={setWithPeople} label="부서 업무보고 포함" />
          <button onClick={toggleFull} className="inline-flex items-center gap-1 font-semibold text-ink-2 hover:text-ink">
            {full ? <Minimize size={16} /> : <Expand size={16} />}{full ? '창 모드' : '전체 화면'}
          </button>
          <button onClick={onClose} aria-label="회의 화면 닫기" className="rounded-lg p-1.5 text-ink-3 hover:bg-sunken hover:text-ink"><X size={20} /></button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10">
          {slide?.kind === 'cover' && <Cover summary={summary} count={slides.length - 1} />}
          {slide?.kind === 'site' && <SiteSlide site={slide.site} />}
          {slide?.kind === 'person' && <PersonSlide member={slide.member} />}
        </div>
      </main>

      <footer className="border-t border-line bg-surface px-5 py-2.5">
        <div className="mx-auto flex max-w-[1280px] items-center gap-4">
          <button onClick={() => go(index - 1)} disabled={index === 0} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold hover:bg-sunken disabled:opacity-30"><ChevronLeft size={20} />이전</button>
          <div className="min-w-0 flex-1">
            <p className="mb-1 truncate text-center text-[13px] text-ink-3">{label(slides[index])} · <b className="tabular text-ink">{index + 1}</b> / {slides.length}</p>
            <Progress value={slides.length > 1 ? (index / (slides.length - 1)) * 100 : 100} />
          </div>
          <button onClick={() => go(index + 1)} disabled={index === last} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold hover:bg-sunken disabled:opacity-30">다음<ChevronRight size={20} /></button>
        </div>
      </footer>
    </div>
  );
}

function label(s: Slide | undefined): string {
  if (!s || s.kind === 'cover') return '요약';
  return s.kind === 'site' ? s.site.name : `${s.member.name} ${s.member.title}`;
}

function Cover({ summary, count }: { summary: AiSummary | null; count: number }) {
  const { snap, weekId } = useStore();
  if (!snap) return null;
  const people = reporters(snap);
  const written = people.filter((m) => hasWritten(snap, m.id)).length;
  const directives = activeDirectives(snap.directives);
  const done = directives.filter((d) => d.status === 'done').length;
  const prevOpen = activeDirectives(snap.prevDirectives).filter((d) => d.status !== 'done').length;
  const imminent = visibleSites(snap).filter(isImminent);
  return (
    <div className="py-6">
      <p className="text-[18px] font-semibold text-ink-3">사닥다리종합건설 주간 회의</p>
      <h1 className="mt-1 text-[44px] font-extrabold tracking-tight">{weekLabelLong(weekId)}</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label="보고 작성" value={`${written} / ${people.length}명`} />
        <Stat label="지시 처리" value={directives.length ? `${done} / ${directives.length}건 완료` : '지시 없음'} sub={prevOpen ? `지난주 미완료 ${prevOpen}건` : undefined} />
        <Stat label="준공 90일 이내" value={`${imminent.length}곳`} sub={imminent.slice(0, 3).map((s) => s.name).join(', ')} />
      </div>
      {summary && summary.highlights.length > 0 && (
        <section className="mt-8 rounded-2xl border border-brand/25 bg-brand-soft/50 p-6">
          <h2 className="mb-3 flex items-center gap-2 text-[20px] font-bold"><Sparkles size={20} className="text-brand" />이번 주 핵심</h2>
          <ol className="space-y-2.5">
            {summary.highlights.map((h, i) => (
              <li key={i} className="flex gap-3 text-[19px] leading-[1.6]"><b className="tabular text-brand-ink">{i + 1}</b>{h}</li>
            ))}
          </ol>
        </section>
      )}
      <p className="mt-10 text-[16px] text-ink-3">→ 키(또는 스페이스)로 다음 화면, ← 키로 이전 화면. 이어서 {count}개 화면이 있습니다.</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-[15px] font-semibold text-ink-3">{label}</p>
      <p className="mt-1 text-[30px] font-extrabold tabular">{value}</p>
      {sub && <p className="mt-1 truncate text-[14px] font-semibold text-warn">{sub}</p>}
    </div>
  );
}

function StatusPill({ d }: { d: Directive }) {
  const tone = d.status === 'done' ? 'ok' : d.status === 'doing' ? 'brand' : 'neutral';
  return <Badge tone={tone}>처리: {DIRECTIVE_STATUS.find((s) => s.id === d.status)?.label}</Badge>;
}

function SiteSlide({ site }: { site: Site }) {
  const { snap, me } = useStore();
  if (!snap) return null;
  const due = dueInfo(site);
  const directive = siteDirective(snap.directives, site.id);
  const photos = snap.photos.filter((p) => p.siteId === site.id).slice(0, 6);
  const depts = siteDepartments(snap);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[36px] font-extrabold tracking-tight">{site.name}</h1>
        <StageChip stage={site.stage} />
        {isImminent(site) && <Badge tone="warn">준공임박</Badge>}
        {site.tags.map((t) => <Badge key={t}>{t}</Badge>)}
      </div>
      <p className="mt-1 text-[17px] text-ink-3">{[site.note, site.process].filter(Boolean).join(' · ')}</p>
      <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3">
        {site.progress != null ? (
          <div className="flex min-w-[320px] flex-1 items-center gap-4"><Progress value={site.progress} className="!h-3" /><b className="shrink-0 whitespace-nowrap text-[28px] tabular">{site.progress}%</b></div>
        ) : site.scale ? <p className="text-[20px] font-semibold">{site.scale}</p> : null}
        <p className={cx('text-[18px] font-semibold', due.tone === 'warn' ? 'text-warn' : due.tone === 'danger' ? 'text-danger' : due.tone === 'ok' ? 'text-ok' : 'text-ink-2')}>{due.label}</p>
      </div>

      {has(directive?.content) && (
        <section className="mt-6 rounded-2xl border border-note-line bg-note px-5 py-4">
          <div className="mb-1.5 flex items-center gap-2"><span className="text-[14px] font-bold text-note-ink">대표님 지시</span><StatusPill d={directive!} /></div>
          <p className="whitespace-pre-wrap text-[18px] leading-[1.65]">{directive!.content}</p>
        </section>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {depts.map((d) => {
          const can = canViewDept(me, d.id, snap.grants);
          const e = siteEntry(snap.entries, site.id, d.id);
          const status = siteStatusOf(snap, site.id, d.id);
          if (!status && !has(e?.content)) return null;
          return (
            <section key={d.id} className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <h3 className="mb-2 text-[16px] font-bold text-ink-2">{d.name}</h3>
              {can ? <DiffText text={e?.content} prev={siteEntry(snap.prevEntries, site.id, d.id)?.content} className="[&_p]:text-[17px] [&_p]:leading-[1.7]" />
                : <p className="flex items-center gap-1.5 text-[15px] text-ink-3"><Lock size={15} />작성함 · 열람 권한 없음</p>}
            </section>
          );
        })}
      </div>
      {depts.every((d) => !siteStatusOf(snap, site.id, d.id)) && <p className="mt-6 text-[17px] text-ink-3">이번 주 이 현장 보고가 없습니다.</p>}

      {photos.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-3">
          {photos.map((p) => <img key={p.id} src={p.url} alt="현장 사진" className="h-36 w-48 rounded-xl border border-line object-cover" />)}
        </div>
      )}
    </div>
  );
}

function PersonSlide({ member }: { member: Member }) {
  const { snap } = useStore();
  if (!snap) return null;
  const dept = snap.departments.find((d) => d.id === member.departmentId);
  const e = personEntry(snap.entries, member.id);
  const directive = memberDirective(snap.directives, member.id);
  return (
    <div>
      <p className="text-[17px] font-semibold text-ink-3">{dept?.name} · 부서 업무보고</p>
      <h1 className="mt-1 text-[36px] font-extrabold tracking-tight">{member.name} <span className="font-semibold text-ink-3">{member.title}</span></h1>
      {has(directive?.content) && (
        <section className="mt-5 rounded-2xl border border-note-line bg-note px-5 py-4">
          <div className="mb-1.5 flex items-center gap-2"><span className="text-[14px] font-bold text-note-ink">대표님 지시</span><StatusPill d={directive!} /></div>
          <p className="whitespace-pre-wrap text-[18px] leading-[1.65]">{directive!.content}</p>
        </section>
      )}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-6 shadow-card">
        <DiffText text={e?.content} prev={personEntry(snap.prevEntries, member.id)?.content} className="[&_p]:text-[17px] [&_p]:leading-[1.75]" />
      </section>
    </div>
  );
}
