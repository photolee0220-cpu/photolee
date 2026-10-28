import { ChevronRight, MapPin, MessageSquareText } from 'lucide-react';
import { attachmentsFor, FileCount } from '../components/Attachments';
import { PhotoCount } from '../components/Photos';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { Avatar, Badge, Card, cx, Empty, Spinner } from '../components/ui';
import { canViewDept } from '../lib/access';
import { activeDepartments, commentsFor, firstLines, has, hasWritten, memberDirective, miscEntry, personEntry, siteEntry, siteWork } from '../lib/derive';
import type { Entry, Member } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { DiffModeSwitch, DiffText } from '../components/DiffText';

/** 부서별, 사람별 보고 카드. 현장 보고 부서 사람은 쓴 현장 보고 전체를 넓은 카드로 먼저 보여준다 */
export function PeopleGrid({ compact, onlyDepartments }: { compact?: boolean; onlyDepartments?: string[] }) {
  const { snap, me, openDrawer } = useStore();
  if (!snap) return null;
  const depts = activeDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants) && (!onlyDepartments || onlyDepartments.includes(d.id)));
  const people = depts.flatMap((d) => snap.members.filter((m) => m.active && m.departmentId === d.id).map((m) => ({ m, dept: d })));
  if (!people.length) return <Empty title="볼 수 있는 부서 보고가 없습니다" />;
  const siteWriters = people.filter((x) => x.dept.writesSites);
  const others = people.filter((x) => !x.dept.writesSites);

  return (
    <div className="space-y-3">
      {siteWriters.map(({ m, dept }) => (
        <SiteWriterCard key={m.id} member={m} deptName={dept.name} onOpen={() => openDrawer({ type: 'person', id: m.id })} />
      ))}
      {others.length > 0 && (
        <div className={cx('grid gap-3', compact ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-3')}>
          {others.map(({ m, dept }) => (
            <PersonCard key={m.id} member={m} deptName={dept.name} compact={compact} onOpen={() => openDrawer({ type: 'person', id: m.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardHead({ member, deptName, written, right }: { member: Member; deptName: string; written: boolean; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar id={member.id} name={member.name} size={32} muted={!written} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate font-bold">{member.name} <span className="font-medium text-ink-3">{member.title}</span></p>
        <p className="truncate text-[12px] text-ink-3">{deptName}</p>
      </div>
      {right}
      {written ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}
    </div>
  );
}

function DirectiveLine({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg bg-note px-2.5 py-1.5 text-[12.5px] leading-[1.55]">
      <span className="line-clamp-2 whitespace-pre-line"><span className="mr-1 font-bold text-note-ink">지시</span>{firstLines(text, 2)}</span>
    </p>
  );
}

/** 현장 보고 부서 사람: 이번 주 쓴 현장 보고·기타사항·부서 업무보고를 전부 보여준다 */
function SiteWriterCard({ member, deptName, onOpen }: { member: Member; deptName: string; onOpen(): void }) {
  const { snap, openDrawer } = useStore();
  if (!snap) return null;
  const e = personEntry(snap.entries, member.id);
  const directive = memberDirective(snap.directives, member.id);
  const work = siteWork(snap, member.id);
  const siteCount = work.filter((x) => x.kind === 'site').length;
  const items = has(e?.content) ? [...work, e!] : work;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <CardHead member={member} deptName={deptName} written={hasWritten(snap, member.id)}
        right={<button type="button" onClick={onOpen} className="mr-1 text-[12.5px] font-semibold text-brand-ink hover:underline">자세히·피드백</button>} />
      {has(directive?.content) && <DirectiveLine text={directive!.content} />}
      {items.length === 0 ? <p className="mt-3 text-[13px] text-ink-3">아직 작성하지 않았습니다</p> : (
        <>
          <p className="mb-2 mt-4 flex items-center gap-1 text-[12px] font-semibold text-ink-3"><MapPin size={12} />현장 보고 {siteCount}곳{work.length > siteCount && ' · 기타사항'}{has(e?.content) && ' · 부서 업무보고'}</p>
          <div className="grid items-start gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((w) => <WorkBlock key={w.id} entry={w} onOpenSite={(id) => openDrawer({ type: 'site', id })} onOpenOther={onOpen} />)}
          </div>
        </>
      )}
    </section>
  );
}

function WorkBlock({ entry, onOpenSite, onOpenOther }: { entry: Entry; onOpenSite(id: string): void; onOpenOther(): void }) {
  const { snap } = useStore();
  if (!snap) return null;
  const site = entry.kind === 'site' ? snap.sites.find((s) => s.id === entry.siteId) : undefined;
  const title = site?.name ?? (entry.kind === 'misc' ? '기타사항' : '부서 업무보고');
  const prev = entry.kind === 'site' ? siteEntry(snap.prevEntries, entry.siteId!, entry.departmentId)
    : entry.kind === 'misc' ? miscEntry(snap.prevEntries, entry.departmentId) : personEntry(snap.prevEntries, entry.authorId ?? '');
  const photos = site ? snap.photos.filter((p) => p.siteId === site.id && p.departmentId === entry.departmentId).length : 0;
  const files = attachmentsFor(snap.attachments, { kind: entry.kind, siteId: entry.siteId, departmentId: entry.departmentId, authorId: entry.authorId }).length;
  const comments = commentsFor(snap.comments, entry.id).length;

  return (
    <div className="rounded-xl border border-line bg-sunken/40 px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <button type="button" onClick={() => (site ? onOpenSite(site.id) : onOpenOther())}
          className="inline-flex min-w-0 items-center gap-0.5 text-[14px] font-bold hover:text-brand-ink">
          <span className="truncate">{title}</span><ChevronRight size={15} className="shrink-0 text-ink-3" />
        </button>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <PhotoCount count={photos} />
          <FileCount count={files} />
          {comments > 0 && <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink"><MessageSquareText size={13} />{comments}</span>}
        </span>
      </div>
      <DiffText text={entry.content} prev={prev?.content} className="text-ink-2 [&_p]:text-[13px] [&_p]:leading-[1.6]" />
    </div>
  );
}

function PersonCard({ member, deptName, compact, onOpen }: { member: Member; deptName: string; compact?: boolean; onOpen(): void }) {
  const { snap } = useStore();
  if (!snap) return null;
  const e = personEntry(snap.entries, member.id);
  const directive = memberDirective(snap.directives, member.id);
  const comments = commentsFor(snap.comments, e?.id);

  return (
    <Card onClick={onOpen} className="flex h-full flex-col p-4">
      <CardHead member={member} deptName={deptName} written={hasWritten(snap, member.id)} />
      {has(directive?.content) && <DirectiveLine text={directive!.content} />}
      <div className="mt-3 flex-1">
        {has(e?.content)
          ? <DiffText text={e!.content} prev={personEntry(snap.prevEntries, member.id)?.content} clamp={compact ? 4 : 7} className="text-ink-2 [&_p]:text-[13px] [&_p]:leading-[1.6]" />
          : <p className="text-[13px] text-ink-3">아직 작성하지 않았습니다</p>}
      </div>
      <div className="mt-3 flex items-center justify-between text-[12px] text-ink-3">
        <span>{e && has(e.content) ? `${relativeTime(e.updatedAt)} 수정` : ''}</span>
        {comments.length > 0 && <span className="inline-flex items-center gap-1 font-semibold text-brand-ink"><MessageSquareText size={13} />{comments.length}</span>}
      </div>
    </Card>
  );
}

export function People() {
  const { snap } = useStore();
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="부서 보고" right={<WeekSwitcher />}><DeadlineBadge /><DiffModeSwitch /></PageHeader>
      <PeopleGrid />
    </div>
  );
}
