import { MapPin, MessageSquareText } from 'lucide-react';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { Avatar, Badge, Card, cx, Empty, Spinner } from '../components/ui';
import { canViewDept } from '../lib/access';
import { activeDepartments, commentsFor, firstLines, has, hasWritten, memberDirective, personEntry, siteWork } from '../lib/derive';
import { headingText, isHeading } from '../lib/sections';
import type { Entry, Member } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { DiffModeSwitch, DiffText } from '../components/DiffText';

/** 부서별, 사람별 보고 카드. 모두 같은 크기이고 앞부분만 보이며, 누르면 전체를 연다 */
export function PeopleGrid({ compact, onlyDepartments }: { compact?: boolean; onlyDepartments?: string[] }) {
  const { snap, me, openDrawer } = useStore();
  if (!snap) return null;
  const depts = activeDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants) && (!onlyDepartments || onlyDepartments.includes(d.id)));
  const people = depts.flatMap((d) => snap.members.filter((m) => m.active && m.departmentId === d.id).map((m) => ({ m, dept: d })));
  if (!people.length) return <Empty title="볼 수 있는 부서 보고가 없습니다" />;

  return (
    <div className={cx('grid gap-3', compact ? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-3')}>
      {people.map(({ m, dept }) => (
        <PersonCard key={m.id} member={m} deptName={dept.name} siteWriter={dept.writesSites} onOpen={() => openDrawer({ type: 'person', id: m.id })} />
      ))}
    </div>
  );
}

/** 첫 줄 미리보기. 대주제 줄은 제목만 */
function previewLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return isHeading(line) ? headingText(line) : line.trim();
}

const SITE_ROWS = 5;

function SiteWorkList({ entries }: { entries: Entry[] }) {
  const { snap } = useStore();
  if (!snap) return null;
  return (
    <ul className="space-y-1">
      {entries.slice(0, SITE_ROWS).map((e) => (
        <li key={e.id} className="flex min-w-0 items-baseline gap-2 text-[13px] leading-[1.55]">
          <span className="shrink-0 font-semibold text-ink">{e.kind === 'misc' ? '기타사항' : snap.sites.find((s) => s.id === e.siteId)?.name}</span>
          <span className="min-w-0 truncate text-ink-2">{previewLine(e.content)}</span>
        </li>
      ))}
    </ul>
  );
}

function PersonCard({ member, deptName, siteWriter, onOpen }: { member: Member; deptName: string; siteWriter: boolean; onOpen(): void }) {
  const { snap } = useStore();
  if (!snap) return null;
  const e = personEntry(snap.entries, member.id);
  const directive = memberDirective(snap.directives, member.id);
  const work = siteWriter ? siteWork(snap, member.id) : [];
  const siteCount = work.filter((x) => x.kind === 'site').length;
  const comments = [...work, ...(e ? [e] : [])].reduce((n, x) => n + commentsFor(snap.comments, x.id).length, 0);
  const written = hasWritten(snap, member.id);
  const hidden = work.length > SITE_ROWS ? work.length - SITE_ROWS : 0;
  const latest = [...work, ...(e && has(e.content) ? [e] : [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  let body: React.ReactNode;
  if (work.length) {
    body = (
      <>
        <p className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-ink-3"><MapPin size={12} />현장 보고 {siteCount}곳{has(e?.content) && ' · 부서 업무보고'}</p>
        <SiteWorkList entries={work} />
      </>
    );
  } else if (has(e?.content)) {
    body = <DiffText text={e!.content} prev={personEntry(snap.prevEntries, member.id)?.content} clamp={has(directive?.content) ? 4 : 6} className="text-ink-2 [&_p]:text-[13px] [&_p]:leading-[1.6]" />;
  } else {
    body = <p className="text-[13px] text-ink-3">아직 작성하지 않았습니다</p>;
  }

  return (
    <Card onClick={onOpen} className="flex h-[272px] flex-col overflow-hidden p-4">
      <div className="flex items-center gap-2.5">
        <Avatar id={member.id} name={member.name} size={32} muted={!written} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-bold">{member.name} <span className="font-medium text-ink-3">{member.title}</span></p>
          <p className="truncate text-[12px] text-ink-3">{deptName}</p>
        </div>
        {written ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}
      </div>
      {has(directive?.content) && (
        <p className="mt-3 shrink-0 rounded-lg bg-note px-2.5 py-1.5 text-[12.5px] leading-[1.55]">
          <span className="line-clamp-2 whitespace-pre-line"><span className="mr-1 font-bold text-note-ink">지시</span>{firstLines(directive!.content, 2)}</span>
        </p>
      )}
      <div className="relative mt-3 min-h-0 flex-1 overflow-hidden">
        {body}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-surface" />
      </div>
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-[12px] text-ink-3">
        <span className="truncate">{latest ? `${relativeTime(latest.updatedAt)} 수정` : ''}</span>
        <span className="flex shrink-0 items-center gap-2.5">
          {comments > 0 && <span className="inline-flex items-center gap-1 font-semibold text-brand-ink"><MessageSquareText size={13} />{comments}</span>}
          {written && <span className="font-semibold text-brand-ink">{hidden ? `외 ${hidden}건 · ` : ''}전체 보기</span>}
        </span>
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
