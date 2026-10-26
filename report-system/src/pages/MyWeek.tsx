import { CalendarClock, ChevronDown, Download, MessageSquareText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { DirectiveBox, EntryEditor, Feedback, TextBlock } from '../components/editors';
import { dueInfo } from '../components/SiteCard';
import { Badge, Button, cx, Progress, Segmented, Spinner, StageChip } from '../components/ui';
import {
  byId, commentsFor, has, isCompleted, memberDirective, miscDirective, miscEntry, personEntry, siteDirective, siteEntry, visibleSites,
} from '../lib/derive';
import { STAGES, type Site } from '../lib/types';
import { relativeTime, weekLabel } from '../lib/week';
import { useStore } from '../state/store';
import { useExport } from './useExport';

type Filter = 'all' | 'directive' | 'todo';

export function MyWeek() {
  const { snap, me, weekId, saveEntry } = useStore();
  const exportWeek = useExport();
  const [filter, setFilter] = useState<Filter>('all');
  const [showPersonal, setShowPersonal] = useState(false);
  const dept = snap?.departments.find((d) => d.id === me.departmentId);
  const sites = useMemo(() => (snap ? visibleSites(snap) : []), [snap]);
  if (!snap || !dept) return <div className="flex justify-center py-20"><Spinner /></div>;

  const members = byId(snap.members);
  const mine = personEntry(snap.entries, me.id);
  const special = miscDirective(snap.directives, 'special');
  const siteWriter = dept.writesSites;
  const writtenSites = sites.filter((s) => has(siteEntry(snap.entries, s.id, dept.id)?.content));
  const newFeedback = snap.comments.filter((c) => !c.acknowledgedAt && members.get(c.authorId)?.isCeo
    && snap.entries.some((e) => e.id === c.entryId && (e.kind === 'dept' ? e.authorId === me.id : e.departmentId === dept.id)));

  const filtered = sites.filter((s) => {
    if (filter === 'directive') return has(siteDirective(snap.directives, s.id)?.content);
    if (filter === 'todo') return !has(siteEntry(snap.entries, s.id, dept.id)?.content);
    return true;
  });

  const personal = (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-bold">{siteWriter ? '부서 업무보고 (선택)' : '이번 주 업무 진행사항'}</h2>
        {has(mine?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}
      </div>
      <div className="space-y-3">
        <DirectiveBox value={memberDirective(snap.directives, me.id)?.content ?? ''} editable={false} onSave={async () => undefined} hideWhenEmpty={siteWriter} />
        <EntryEditor
          key={`${weekId}-me`}
          value={mine?.content ?? ''}
          editable
          prevContent={personEntry(snap.prevEntries, me.id)?.content}
          placeholder={'1. 진행한 일\n2. 다음 주 예정\n3. 협조가 필요한 일'}
          meta={mine && has(mine.content) ? `${relativeTime(mine.updatedAt)} 저장` : '입력하면 자동으로 저장됩니다'}
          onSave={(content) => saveEntry({ weekId, kind: 'dept', siteId: null, departmentId: dept.id, authorId: me.id, content })}
        />
        <Feedback entry={mine} />
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-[920px]">
      <PageHeader title="이번 주 작성" right={<>
        <WeekSwitcher />
        <Button size="sm" onClick={() => exportWeek(snap)}><Download size={15} />엑셀</Button>
      </>}>
        <DeadlineBadge />
        <Badge tone="neutral" className="!py-1">{dept.name}</Badge>
      </PageHeader>

      {newFeedback.length > 0 && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[13.5px] font-semibold text-brand-ink">
          <MessageSquareText size={18} />대표님 피드백 {newFeedback.length}건이 확인을 기다립니다. 해당 칸 아래에서 확인해 주세요.
        </div>
      )}

      {has(special?.content) && (
        <div className="mb-4">
          <DirectiveBox label="이번 주 특별 지시사항" value={special!.content} editable={false} onSave={async () => undefined} />
        </div>
      )}

      {!siteWriter && personal}

      {siteWriter && (
        <>
          <div className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-bold">현장별 보고</span>
              <span className="tabular text-ink-3"><b className="text-ink">{writtenSites.length}</b> / {sites.length}곳 작성</span>
            </div>
            <Progress value={sites.length ? (writtenSites.length / sites.length) * 100 : 0} className="mt-2" />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented<Filter> value={filter} onChange={setFilter} options={[
              { id: 'all', label: '전체' },
              { id: 'directive', label: '지시 있는 현장' },
              { id: 'todo', label: '아직 안 쓴 현장' },
            ]} />
          </div>
          <div className="space-y-6">
            {STAGES.map((st) => {
              const list = filtered.filter((s) => s.stage === st.id);
              if (!list.length) return null;
              return (
                <section key={st.id}>
                  <h3 className="mb-2 text-[14px] font-bold text-ink-2">{st.label} <span className="text-ink-3">{list.length}</span></h3>
                  <div className="space-y-2.5">
                    {list.map((s) => <SiteWriteCard key={s.id} site={s} deptId={dept.id} />)}
                  </div>
                </section>
              );
            })}
            {!filtered.length && <p className="py-8 text-center text-[13px] text-ink-3">해당하는 현장이 없습니다.</p>}
          </div>

          <MiscCard deptId={dept.id} />

          <div className="mt-6">
            {showPersonal || has(mine?.content) ? personal : (
              <button onClick={() => setShowPersonal(true)} className="w-full rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13.5px] font-semibold text-ink-2 hover:bg-surface">
                + 현장과 별개로 부서 업무보고 쓰기
              </button>
            )}
          </div>
        </>
      )}

      {!siteWriter && <MiscCard deptId={dept.id} optional />}
      <p className="mt-8 text-center text-[12px] text-ink-3">{weekLabel(weekId)} · 입력한 내용은 자동 저장되며 마감 후에도 고칠 수 있습니다</p>
    </div>
  );
}

function SiteWriteCard({ site, deptId }: { site: Site; deptId: string }) {
  const { snap, weekId, saveEntry } = useStore();
  const e = snap ? siteEntry(snap.entries, site.id, deptId) : undefined;
  const directive = snap ? siteDirective(snap.directives, site.id) : undefined;
  const prev = snap ? siteEntry(snap.prevEntries, site.id, deptId) : undefined;
  const [open, setOpen] = useState(() => has(e?.content) || has(directive?.content) || has(prev?.content) || !isCompleted(site));
  if (!snap) return null;
  const due = dueInfo(site);
  const unacked = commentsFor(snap.comments, e?.id).filter((c) => !c.acknowledgedAt).length;

  return (
    <article className={cx('rounded-xl border bg-surface shadow-card', has(e?.content) ? 'border-line' : 'border-line-strong')}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold">{site.name}</span>
            <StageChip stage={site.stage} />
            {has(directive?.content) && <Badge tone="note">지시</Badge>}
            {unacked > 0 && <Badge tone="brand"><MessageSquareText size={11} />피드백 {unacked}</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
            <span>{site.process || site.note}</span>
            {!(site.stage === 'construction' && isCompleted(site)) && <span className="inline-flex items-center gap-1"><CalendarClock size={12} />{due.label}</span>}
            {site.progress != null && <span className="font-semibold text-ink-2">{site.progress}%</span>}
          </p>
        </div>
        {has(e?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}
        <ChevronDown size={18} className={cx('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-4 pb-4 pt-3">
          {has(directive?.content) && <DirectiveBox value={directive!.content} editable={false} onSave={async () => undefined} />}
          <EntryEditor
            key={`${weekId}-${site.id}`}
            compact
            value={e?.content ?? ''}
            editable
            prevContent={prev?.content}
            onSave={(content) => saveEntry({ weekId, kind: 'site', siteId: site.id, departmentId: deptId, authorId: null, content })}
          />
          {has(prev?.content) && has(e?.content) && (
            <details className="text-[13px]">
              <summary className="cursor-pointer font-semibold text-ink-3">지난주에 쓴 내용</summary>
              <TextBlock text={prev!.content} className="mt-1.5 !text-[13px] text-ink-2" />
            </details>
          )}
          <Feedback entry={e} />
        </div>
      )}
    </article>
  );
}

function MiscCard({ deptId, optional }: { deptId: string; optional?: boolean }) {
  const { snap, weekId, saveEntry } = useStore();
  const e = snap ? miscEntry(snap.entries, deptId) : undefined;
  const [open, setOpen] = useState(!optional || has(e?.content));
  if (!snap) return null;
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-4 w-full rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13.5px] font-semibold text-ink-2 hover:bg-surface">
        + 기타사항 쓰기 (현장 외 진행 건, 공유할 내용)
      </button>
    );
  }
  return (
    <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <h2 className="mb-3 text-[16px] font-bold">기타사항</h2>
      <EntryEditor
        key={`${weekId}-misc`}
        compact
        value={e?.content ?? ''}
        editable
        prevContent={miscEntry(snap.prevEntries, deptId)?.content}
        placeholder="현장 외 진행 건, 공유할 내용"
        onSave={(content) => saveEntry({ weekId, kind: 'misc', siteId: null, departmentId: deptId, authorId: null, content })}
      />
      <Feedback entry={e} />
    </section>
  );
}
