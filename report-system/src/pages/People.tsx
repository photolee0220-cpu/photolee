import { MessageSquareText } from 'lucide-react';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { Avatar, Badge, Card, cx, Empty, Spinner } from '../components/ui';
import { canViewDept } from '../lib/access';
import { activeDepartments, commentsFor, firstLines, has, hasWritten, memberDirective, personEntry } from '../lib/derive';
import type { Member } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';

/** 부서별, 사람별 보고 카드 */
export function PeopleGrid({ compact, onlyDepartments }: { compact?: boolean; onlyDepartments?: string[] }) {
  const { snap, me, openDrawer } = useStore();
  if (!snap) return null;
  const depts = activeDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants) && (!onlyDepartments || onlyDepartments.includes(d.id)));
  const groups = depts.map((d) => ({
    dept: d,
    people: snap.members.filter((m) => m.active && m.departmentId === d.id),
  })).filter((g) => g.people.length);

  if (!groups.length) return <Empty title="볼 수 있는 부서 보고가 없습니다" />;

  return (
    <div className={cx('grid gap-3', compact ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-3')}>
      {groups.flatMap(({ dept, people }) => people.map((m) => (
        <PersonCard key={m.id} member={m} deptName={dept.name} siteWriter={dept.writesSites} compact={compact} onOpen={() => openDrawer({ type: 'person', id: m.id })} />
      )))}
    </div>
  );
}

function PersonCard({ member, deptName, siteWriter, compact, onOpen }: { member: Member; deptName: string; siteWriter: boolean; compact?: boolean; onOpen(): void }) {
  const { snap, openDrawer, setView, me } = useStore();
  if (!snap) return null;
  const e = personEntry(snap.entries, member.id);
  const directive = memberDirective(snap.directives, member.id);
  const comments = commentsFor(snap.comments, e?.id);
  const written = hasWritten(snap, member.id);
  const siteCount = siteWriter ? snap.entries.filter((x) => x.kind === 'site' && x.departmentId === member.departmentId && has(x.content)).length : 0;

  const body = has(e?.content)
    ? <p className={cx('whitespace-pre-line text-[13px] leading-[1.6] text-ink-2', compact ? 'line-clamp-3' : 'line-clamp-6')}>{firstLines(e!.content, compact ? 3 : 6)}</p>
    : siteWriter
      ? <p className="text-[13px] text-ink-2">현장별 보고 <b className="text-ink">{siteCount}건</b> 작성{(me.isCeo || me.isAdmin) && <> · <span role="link" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); setView('table'); openDrawer(null); }} className="font-semibold text-brand-ink hover:underline">표에서 보기</span></>}</p>
      : <p className="text-[13px] text-ink-3">아직 작성하지 않았습니다</p>;

  return (
    <Card onClick={onOpen} className="flex h-full flex-col p-4">
      <div className="flex items-center gap-2.5">
        <Avatar id={member.id} name={member.name} size={32} muted={!written} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold">{member.name} <span className="font-medium text-ink-3">{member.title}</span></p>
          <p className="truncate text-[12px] text-ink-3">{deptName}</p>
        </div>
        {written ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}
      </div>
      {has(directive?.content) && (
        <p className="mt-3 line-clamp-2 whitespace-pre-line rounded-lg bg-note px-2.5 py-1.5 text-[12.5px] leading-[1.55]">
          <span className="mr-1 font-bold text-note-ink">지시</span>{firstLines(directive!.content, 2)}
        </p>
      )}
      <div className="mt-3 flex-1">{body}</div>
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
      <PageHeader title="부서 보고" right={<WeekSwitcher />}><DeadlineBadge /></PageHeader>
      <PeopleGrid />
    </div>
  );
}
