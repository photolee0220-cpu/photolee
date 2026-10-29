import { ChevronDown, ChevronRight, History, Lock, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { canEditEntry, canViewDept, isWeekLocked } from '../lib/access';
import type { SiteHistoryItem } from '../lib/api';
import { api } from '../lib/client';
import {
  activeDirectives, byId, commentsFor, has, hasWritten, memberDirective, personEntry, reporters, siteDepartments, siteDirective, siteEntry, siteStatusOf, siteWork,
} from '../lib/derive';
import { DIRECTIVE_STATUS, isBuildStage, type Comment, type Site, type SiteSummary, type Department, type Directive, type DirectiveStatus, type Entry, type Member } from '../lib/types';
import { formatDate, relativeTime, toIsoDate, weekLabel } from '../lib/week';
import { summaryModel } from '../lib/models';
import { buildSiteSummaryPrompt } from '../lib/summary';
import { useStore } from '../state/store';
import { AttachmentList } from './Attachments';
import { DiffText } from './DiffText';
import { DirectiveBox, DirectiveStatusBar, EntryEditor, Feedback, SectionEditor, TextBlock } from './editors';
import { PhotoStrip } from './Photos';
import { dueInfo, isImminent } from './SiteCard';
import { Avatar, Badge, Button, cx, Progress, Segmented, Sheet, Spinner, StageChip } from './ui';

export function DrawerHost() {
  const { drawer, openDrawer } = useStore();
  const close = () => openDrawer(null);
  if (!drawer) return null;
  if (drawer.type === 'site') return <SiteDrawer id={drawer.id} onClose={close} />;
  if (drawer.type === 'writers') return <WritersDrawer onClose={close} />;
  if (drawer.type === 'feedback') return <FeedbackDrawer onClose={close} />;
  if (drawer.type === 'directives') return <DirectivesDrawer onClose={close} />;
  return <PersonDrawer id={drawer.id} onClose={close} />;
}

function Block({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function entryMeta(e: Entry | undefined, members: Map<string, Member>) {
  if (!e || !has(e.content)) return null;
  const who = e.updatedBy ? members.get(e.updatedBy)?.name : '';
  return `${who ? `${who} · ` : ''}${relativeTime(e.updatedAt)} 수정`;
}

function deptPeople(d: Department, members: Member[]) {
  return members.filter((m) => m.active && m.departmentId === d.id).map((m) => m.name).join(', ');
}

function SiteDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { snap, me, weekId, saveEntry, saveDirective } = useStore();

  const site = snap?.sites.find((s) => s.id === id);
  if (!snap || !site) return null;
  const members = byId(snap.members);
  const depts = siteDepartments(snap);
  const directive = siteDirective(snap.directives, site.id);
  const prevDirective = siteDirective(snap.prevDirectives, site.id);
  const due = dueInfo(site);

  return (
    <Sheet
      open
      onClose={onClose}
      title={site.name}
      subtitle={<span className="flex flex-wrap items-center gap-1.5"><StageChip stage={site.stage} />{[site.note, site.process].filter(Boolean).join(' · ')}</span>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-[12px] font-semibold text-ink-3">{site.progress != null ? '공정율' : '규모'}</p>
            {site.progress != null ? (
              <div className="mt-1.5 flex items-center gap-2"><Progress value={site.progress} /><span className="shrink-0 whitespace-nowrap text-[15px] font-bold tabular">{site.progress}%</span></div>
            ) : <p className="mt-1 font-semibold">{site.scale || '—'}</p>}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink-3">{isBuildStage(site.stage) ? '준공예상일' : '착공예상일'}</p>
            <p className={cx('mt-1 font-semibold tabular', due.tone === 'warn' && 'text-warn', due.tone === 'danger' && 'text-danger', due.tone === 'ok' && 'text-ok')}>
              {site.dueDate ? formatDate(site.dueDate) : site.dueText || '미정'}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink-3">이슈</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {isImminent(site) && <Badge tone="warn">준공임박</Badge>}
              {site.tags.length ? site.tags.map((t) => <Badge key={t}>{t}</Badge>) : !isImminent(site) && <span className="text-ink-3">—</span>}
            </div>
          </div>
        </div>

        <DirectiveBox
          key={`${weekId}-${site.id}`}
          value={directive?.content ?? ''}
          prevContent={prevDirective?.content}
          editable={me.isCeo}
          onSave={(content) => saveDirective({ weekId, targetKind: 'site', siteId: site.id, memberId: null, slot: null, content })}
          directive={directive}
        />

        {depts.map((d) => {
          const status = siteStatusOf(snap, site.id, d.id);
          if (!canViewDept(me, d.id, snap.grants)) {
            return (
              <Block key={d.id} title={<>{d.name} <span className="font-medium text-ink-3">{deptPeople(d, snap.members)}</span></>}
                right={status ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}>
                <p className="flex items-center gap-1.5 text-[13px] text-ink-3">
                  {status ? <><Lock size={13} className="shrink-0" />{relativeTime(status.updatedAt)} 작성 · 열람 권한이 없어 내용은 보이지 않습니다</> : '이번 주에 아직 작성하지 않았습니다'}
                </p>
              </Block>
            );
          }
          const e = siteEntry(snap.entries, site.id, d.id);
          const prev = siteEntry(snap.prevEntries, site.id, d.id);
          const editable = !me.isCeo && !isWeekLocked(me, weekId) && canEditEntry(me, { kind: 'site', departmentId: d.id, authorId: null });
          return (
            <Block key={d.id} title={<>{d.name} <span className="font-medium text-ink-3">{deptPeople(d, snap.members)}</span></>}
              right={has(e?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}>
              <EntryEditor
                key={`${weekId}-${site.id}-${d.id}`}
                value={e?.content ?? ''}
                editable={editable}
                prevContent={prev?.content}
                meta={entryMeta(e, members)}
                onSave={(content) => saveEntry({ weekId, kind: 'site', siteId: site.id, departmentId: d.id, authorId: null, content })}
              />
              <PhotoStrip siteId={site.id} departmentId={d.id} editable={editable} />
              <AttachmentList target={{ kind: 'site', siteId: site.id, departmentId: d.id, authorId: null }} editable={editable} />
              <Feedback entry={e} />
            </Block>
          );
        })}

        <SiteTimeline site={site} />
      </div>
    </Sheet>
  );
}

function PersonDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { snap, me, weekId, saveEntry, saveDirective, openDrawer } = useStore();
  const [showPrev, setShowPrev] = useState(false);
  const person = snap?.members.find((m) => m.id === id);
  if (!snap || !person) return null;
  const dept = snap.departments.find((d) => d.id === person.departmentId);
  const members = byId(snap.members);
  const e = personEntry(snap.entries, person.id);
  const prev = personEntry(snap.prevEntries, person.id);
  const directive = memberDirective(snap.directives, person.id);
  const prevDirective = memberDirective(snap.prevDirectives, person.id);
  const editable = !me.isCeo && !isWeekLocked(me, weekId) && canEditEntry(me, { kind: 'dept', departmentId: person.departmentId ?? '', authorId: person.id });
  const work = dept?.writesSites ? siteWork(snap, person.id) : [];
  const showPersonal = !dept?.writesSites || has(e?.content) || editable;
  const saveMine = (content: string) => saveEntry({ weekId, kind: 'dept', siteId: null, departmentId: person.departmentId!, authorId: person.id, content });

  return (
    <Sheet open onClose={onClose}
      title={<span className="flex items-center gap-2.5"><Avatar id={person.id} name={person.name} size={32} />{person.name} {person.title}</span>}
      subtitle={`${dept?.name ?? ''} · ${weekLabel(weekId)}`}>
      <div className="space-y-4">
        <DirectiveBox
          key={`${weekId}-${person.id}`}
          value={directive?.content ?? ''}
          prevContent={prevDirective?.content}
          editable={me.isCeo}
          onSave={(content) => saveDirective({ weekId, targetKind: 'member', siteId: null, memberId: person.id, slot: null, content })}
          directive={directive}
        />
        {dept?.writesSites && (
          <Block title={<>현장 보고 <span className="font-medium text-ink-3">{work.filter((x) => x.kind === 'site').length}곳</span></>}>
            {work.length === 0 ? <p className="text-[13px] text-ink-3">이번 주에 작성한 현장 보고가 없습니다.</p> : (
              <div className="divide-y divide-line">
                {work.map((w) => {
                  const site = snap.sites.find((s) => s.id === w.siteId);
                  const prevW = siteEntry(snap.prevEntries, w.siteId!, w.departmentId);
                  return (
                    <div key={w.id} className="py-3 first:pt-0 last:pb-0">
                      <button type="button" onClick={() => site && openDrawer({ type: 'site', id: site.id })}
                        className="mb-1.5 inline-flex items-center gap-1 text-[14px] font-bold hover:text-brand-ink">
                        {site?.name}<ChevronRight size={15} className="text-ink-3" />
                      </button>
                      <DiffText text={w.content} prev={prevW?.content} />
                      {site && <PhotoStrip siteId={site.id} departmentId={w.departmentId} editable={false} />}
                      <AttachmentList target={{ kind: w.kind, siteId: w.siteId, departmentId: w.departmentId, authorId: null }} editable={false} />
                      <Feedback entry={w} />
                    </div>
                  );
                })}
              </div>
            )}
          </Block>
        )}
        {showPersonal && (
          <Block title={dept?.writesSites ? '부서 업무보고' : '업무 진행사항'} right={has(e?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}>
            {editable ? (
              <SectionEditor key={`${weekId}-${person.id}`} value={e?.content ?? ''} prevContent={prev?.content} meta={entryMeta(e, members)} onSave={saveMine} />
            ) : (
              <EntryEditor key={`${weekId}-${person.id}`} value={e?.content ?? ''} editable={false} prevContent={prev?.content} meta={entryMeta(e, members)} onSave={saveMine} />
            )}
            <AttachmentList target={{ kind: 'dept', siteId: null, departmentId: person.departmentId ?? '', authorId: person.id }} editable={editable} />
            <Feedback entry={e} />
          </Block>
        )}
        {has(prev?.content) && (
          <Block title={`지난주 (${weekLabel(snap.prevWeekId!)})`} right={
            <button onClick={() => setShowPrev((v) => !v)} className="text-[13px] font-semibold text-brand-ink">{showPrev ? '접기' : '펼치기'}</button>}>
            {showPrev ? <TextBlock text={prev!.content} className="text-ink-2" /> : <p className="line-clamp-2 whitespace-pre-line text-[13px] text-ink-3">{prev!.content}</p>}
          </Block>
        )}
      </div>
    </Sheet>
  );
}

/** 대시보드 '작성 현황': 이번 주 작성한 사람과 안 한 사람 */
function WritersDrawer({ onClose }: { onClose(): void }) {
  const { snap, weekId, openDrawer } = useStore();
  if (!snap) return null;
  const depts = byId(snap.departments);
  const people = reporters(snap);
  const lastWrite = (id: string) => snap.entries.filter((e) => e.updatedBy === id && has(e.content)).map((e) => e.updatedAt).sort().pop();
  const done = people.filter((m) => hasWritten(snap, m.id));
  const missing = people.filter((m) => !hasWritten(snap, m.id));
  const row = (m: Member, at?: string) => (
    <button key={m.id} type="button" onClick={() => openDrawer({ type: 'person', id: m.id })}
      className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-sunken/60">
      <Avatar id={m.id} name={m.name} size={28} muted={!at} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{m.name}</span> <span className="text-ink-3">{m.title}</span>
        <span className="block truncate text-[12px] text-ink-3">{depts.get(m.departmentId!)?.name}</span>
      </span>
      <span className="shrink-0 text-[12px] text-ink-3">{at ? `${relativeTime(at)} 작성` : ''}</span>
      <ChevronRight size={15} className="shrink-0 text-ink-3" />
    </button>
  );

  return (
    <Sheet open onClose={onClose} title="작성 현황" subtitle={`${weekLabel(weekId)} · ${done.length} / ${people.length}명 작성`} width={520}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold">미작성 <Badge tone={missing.length ? 'warn' : 'neutral'}>{missing.length}명</Badge></h3>
          {missing.length ? <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">{missing.map((m) => row(m))}</div>
            : <p className="text-[13px] font-semibold text-ok">모두 작성했습니다</p>}
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold">작성 <Badge tone="brand">{done.length}명</Badge></h3>
          {done.length ? <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">{done.map((m) => row(m, lastWrite(m.id)))}</div>
            : <p className="text-[13px] text-ink-3">아직 작성한 사람이 없습니다</p>}
        </section>
      </div>
    </Sheet>
  );
}

type FeedbackFilter = 'all' | 'open' | 'done';

/** 대시보드 '대표님 피드백': 누구에게 어떤 피드백을 남겼고 확인했는지 */
function FeedbackDrawer({ onClose }: { onClose(): void }) {
  const { snap, weekId, openDrawer } = useStore();
  const [filter, setFilter] = useState<FeedbackFilter>('all');
  if (!snap) return null;
  const members = byId(snap.members);
  const depts = byId(snap.departments);
  const entries = byId(snap.entries);
  const isCeo = (id: string) => !!members.get(id)?.isCeo;
  const ceoComments = snap.comments.filter((c) => isCeo(c.authorId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = ceoComments.filter((c) => !c.acknowledgedAt);
  const list = filter === 'open' ? open : filter === 'done' ? ceoComments.filter((c) => c.acknowledgedAt) : ceoComments;

  const target = (e: Entry | undefined) => {
    if (!e) return { label: '', run: () => undefined };
    if (e.kind === 'site') {
      const site = snap.sites.find((s) => s.id === e.siteId);
      const who = snap.members.filter((m) => m.active && m.departmentId === e.departmentId).map((m) => m.name).join(', ');
      return { label: `${site?.name ?? '현장'} · ${depts.get(e.departmentId)?.name ?? ''}${who ? ` (${who})` : ''}`, run: () => site && openDrawer({ type: 'site', id: site.id }) };
    }
    const m = members.get(e.authorId ?? '');
    return { label: `${m?.name ?? ''} ${m?.title ?? ''} · 부서 업무보고`, run: () => m && openDrawer({ type: 'person', id: m.id }) };
  };
  // 같은 칸에서 이 피드백 뒤, 다음 대표 피드백 전까지 달린 직원 답글
  const repliesOf = (c: Comment) => {
    const thread = commentsFor(snap.comments, c.entryId);
    const next = thread.find((x) => isCeo(x.authorId) && x.createdAt > c.createdAt);
    return thread.filter((x) => !isCeo(x.authorId) && x.createdAt > c.createdAt && (!next || x.createdAt < next.createdAt));
  };

  return (
    <Sheet open onClose={onClose} title="대표님 피드백" subtitle={`${weekLabel(weekId)} · ${ceoComments.length - open.length} / ${ceoComments.length}건 확인`} width={600}>
      <Segmented<FeedbackFilter> value={filter} onChange={setFilter} className="mb-4" options={[
        { id: 'all', label: `전체 ${ceoComments.length}` },
        { id: 'open', label: `미확인 ${open.length}` },
        { id: 'done', label: `확인 ${ceoComments.length - open.length}` },
      ]} />
      {list.length === 0 ? <p className="py-6 text-center text-[13px] text-ink-3">{ceoComments.length ? '해당하는 피드백이 없습니다' : '이번 주에 남긴 피드백이 없습니다'}</p> : (
        <div className="space-y-3">
          {list.map((c) => {
            const t = target(entries.get(c.entryId));
            const replies = repliesOf(c);
            return (
              <button key={c.id} type="button" onClick={t.run}
                className="block w-full rounded-2xl border border-line bg-surface p-4 text-left shadow-card transition-colors hover:border-line-strong">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[13px] font-bold text-brand-ink">{t.label}</p>
                  {c.acknowledgedAt
                    ? <Badge tone="ok">✓ {members.get(c.acknowledgedBy ?? '')?.name ?? ''} 확인 · {relativeTime(c.acknowledgedAt)}</Badge>
                    : <Badge tone="warn">미확인</Badge>}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-[1.65]">{c.content}</p>
                <p className="mt-1 text-[12px] text-ink-3">{relativeTime(c.createdAt)} 남김</p>
                {replies.map((r) => (
                  <div key={r.id} className="mt-2 rounded-lg bg-sunken px-3 py-2 text-[13px]">
                    <span className="font-semibold">{members.get(r.authorId)?.name}</span> <span className="text-ink-3">{relativeTime(r.createdAt)}</span>
                    <p className="mt-0.5 whitespace-pre-wrap leading-[1.6]">{r.content}</p>
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

type DirectiveFilter = 'all' | DirectiveStatus;

/** 대시보드 '지시 처리': 이번 주 지시의 처리 상태와 지난주 미완료 지시 */
function DirectivesDrawer({ onClose }: { onClose(): void }) {
  const { snap, weekId, openDrawer } = useStore();
  const [filter, setFilter] = useState<DirectiveFilter>('all');
  if (!snap) return null;
  const now = activeDirectives(snap.directives);
  const prevOpen = activeDirectives(snap.prevDirectives).filter((d) => d.status !== 'done');
  const list = filter === 'all' ? now : now.filter((d) => d.status === filter);
  const count = (s: DirectiveStatus) => now.filter((d) => d.status === s).length;

  const card = (d: Directive) => {
    const site = d.targetKind === 'site' ? snap.sites.find((s) => s.id === d.siteId) : undefined;
    const m = d.targetKind === 'member' ? snap.members.find((x) => x.id === d.memberId) : undefined;
    const label = site ? `${site.name} · 현장 지시` : `${m?.name ?? ''} ${m?.title ?? ''} · 개인 지시`;
    return (
      <div key={d.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
        <button type="button" onClick={() => (site ? openDrawer({ type: 'site', id: site.id }) : m && openDrawer({ type: 'person', id: m.id }))}
          className="mb-1 inline-flex items-center gap-0.5 text-[13px] font-bold text-brand-ink hover:underline">
          {label}<ChevronRight size={14} />
        </button>
        <p className="line-clamp-4 whitespace-pre-wrap text-[14px] leading-[1.65]">{d.content}</p>
        <div className="-mx-1"><DirectiveStatusBar directive={d} /></div>
      </div>
    );
  };

  return (
    <Sheet open onClose={onClose} title="지시 처리" subtitle={`${weekLabel(weekId)} · ${count('done')} / ${now.length}건 완료`} width={600}>
      <Segmented<DirectiveFilter> value={filter} onChange={setFilter} className="mb-4" options={[
        { id: 'all', label: `전체 ${now.length}` },
        { id: 'open', label: `대기 ${count('open')}` },
        { id: 'doing', label: `진행 중 ${count('doing')}` },
        { id: 'done', label: `완료 ${count('done')}` },
      ]} />
      {list.length === 0 ? <p className="py-6 text-center text-[13px] text-ink-3">{now.length ? '해당하는 지시가 없습니다' : '이번 주 지시사항이 없습니다'}</p>
        : <div className="space-y-3">{list.map(card)}</div>}
      {prevOpen.length > 0 && filter !== 'done' && (
        <section className="mt-6">
          <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold">지난주 미완료 지시 <Badge tone="warn">{prevOpen.length}건</Badge></h3>
          <p className="mb-2 text-[12.5px] text-ink-3">{snap.prevWeekId ? weekLabel(snap.prevWeekId) : ''} 지시 중 아직 완료로 표시되지 않은 것입니다.</p>
          <div className="space-y-3">{prevOpen.map(card)}</div>
        </section>
      )}
    </Sheet>
  );
}

type Range = '3' | '6' | '0';

/** 현장 기록 모아보기: 기간을 골라 주차별 기록을 시간 순서로 보고, 대표·관리자는 AI로 기간 요약 */
function SiteTimeline({ site }: { site: Site }) {
  const { snap, me, weekId, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>('3');
  const [history, setHistory] = useState<SiteHistoryItem[] | null>(null);
  const [summary, setSummary] = useState<SiteSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const canAi = me.isCeo || me.isAdmin;
  useEffect(() => {
    if (!open || history) return;
    api.siteHistory(site.id).then(setHistory).catch(() => setHistory([]));
    if (canAi) api.getSiteSummary(site.id).then(setSummary).catch(() => undefined);
  }, [open, history, site.id, canAi]);
  if (!snap) return null;

  const months = Number(range);
  const cutoff = months ? toIsoDate(new Date(Date.now() - months * 30.5 * 86400000)) : '';
  const inRange = (history ?? []).filter((h) => !cutoff || h.weekId >= cutoff);
  const past = inRange.filter((h) => h.weekId !== weekId);
  const deptName = (id: string) => snap.departments.find((d) => d.id === id)?.name ?? '';

  const makeSummary = async () => {
    if (!inRange.length) return;
    setBusy(true);
    try {
      setSummary(await api.generateSiteSummary(site.id, months || 12, buildSiteSummaryPrompt(site, inRange, deptName, months || 12)));
    } catch (e) {
      toast(e instanceof Error ? e.message : '요약을 만들지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left font-semibold shadow-card hover:bg-sunken">
        <span className="flex items-center gap-2"><History size={17} className="text-ink-3" />기록 모아보기 <span className="text-[12.5px] font-medium text-ink-3">지난 주차 보고·지시·사진</span></span>
        <ChevronDown size={18} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4">
          <Segmented<Range> value={range} onChange={setRange} options={[
            { id: '3', label: '최근 3개월' },
            { id: '6', label: '6개월' },
            { id: '0', label: '전체' },
          ]} />

          {canAi && (
            <section className="rounded-2xl border border-brand/25 bg-brand-soft/50 p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-[14px] font-bold"><Sparkles size={15} className="text-brand" />AI 기간 요약</h4>
                <Button size="sm" tone={summary ? 'secondary' : 'primary'} onClick={makeSummary} disabled={busy || !inRange.length}>
                  {busy ? <><Spinner />정리하는 중</> : summary ? '다시 만들기' : `${months ? `${months}개월` : '전체'} 요약 만들기`}
                </Button>
              </div>
              {summary ? (
                <div className="space-y-3 text-[13.5px] leading-[1.7]">
                  <p>{summary.overview}</p>
                  {summary.milestones.length > 0 && (
                    <ol className="space-y-1 border-l-2 border-brand/30 pl-3">
                      {summary.milestones.map((m, i) => <li key={i}><b className="mr-1.5 tabular text-brand-ink">{m.weekId.slice(5).replace('-', '/')}</b>{m.text}</li>)}
                    </ol>
                  )}
                  {summary.issues.length > 0 && (
                    <div>
                      <p className="mb-1 text-[12.5px] font-bold text-warn">챙겨야 할 것</p>
                      <ul className="space-y-0.5">{summary.issues.map((x, i) => <li key={i}>• {x}</li>)}</ul>
                    </div>
                  )}
                  <p className="text-[12px] text-ink-3">{summaryModel(summary.model).name} · {relativeTime(summary.generatedAt)} · 최근 {summary.months}개월 기준 · AI 요약은 틀릴 수 있으니 원문을 확인하세요</p>
                </div>
              ) : <p className="text-[13px] text-ink-3">고른 기간의 주간보고를 읽고 흐름·주요 사건·챙길 점을 정리합니다. (Haiku 기준 1회 몇 원)</p>}
            </section>
          )}

          {history == null ? <div className="flex justify-center py-4"><Spinner /></div>
            : past.length === 0 ? <p className="px-1 text-[13px] text-ink-3">이 기간에 지난 주차 기록이 없습니다.</p>
              : (
                <ol className="relative space-y-5 border-l-2 border-line pl-4">
                  {past.map((h) => (
                    <li key={h.weekId} className="relative">
                      <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-surface bg-brand" />
                      <p className="text-[13.5px] font-bold">{weekLabel(h.weekId)}</p>
                      {has(h.directive?.content) && (
                        <div className="mt-1.5 rounded-lg bg-note px-3 py-2 text-[13px]">
                          <p className="whitespace-pre-wrap"><b className="text-note-ink">지시 </b>{h.directive!.content}</p>
                          {h.directive!.status && <p className="mt-1 text-[12px] font-semibold text-note-ink">처리: {DIRECTIVE_STATUS.find((s) => s.id === h.directive!.status)?.label}</p>}
                        </div>
                      )}
                      {h.entries.map((e) => (
                        <div key={e.id} className="mt-2">
                          <p className="text-[12px] font-bold text-ink-3">{deptName(e.departmentId)}</p>
                          <TextBlock text={e.content} className="!text-[13px] !leading-[1.6]" />
                        </div>
                      ))}
                      {h.photos.length > 0 && <PhotoStrip siteId={site.id} departmentId="" editable={false} photos={h.photos} />}
                    </li>
                  ))}
                </ol>
              )}
        </div>
      )}
    </>
  );
}
