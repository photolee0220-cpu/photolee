import { CalendarClock, MessageSquareText } from 'lucide-react';
import { commentsFor, firstLines, has, isCompleted, siteDepartments, siteDirective, siteEntry } from '../lib/derive';
import type { Site, Snapshot } from '../lib/types';
import { dday, formatDate } from '../lib/week';
import { canViewDept } from '../lib/access';
import { useStore } from '../state/store';
import { changeCount } from './DiffText';
import { PhotoCount } from './Photos';
import { Badge, Card, cx, Progress, StageChip } from './ui';

export function dueInfo(site: Site): { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' } {
  const prefix = site.stage === 'construction' ? '준공' : '착공';
  if (site.stage === 'construction' && isCompleted(site)) return { label: '준공완료', tone: 'ok' };
  if (!site.dueDate) return { label: `${prefix}예상 ${site.dueText || '미정'}`, tone: 'neutral' };
  const d = dday(site.dueDate)!;
  const date = formatDate(site.dueDate);
  if (d < 0) return { label: `${prefix}예상 ${date} · D+${-d}`, tone: 'danger' };
  return { label: `${prefix}예상 ${date} · D-${d}`, tone: d <= 90 ? 'warn' : 'neutral' };
}

export function isImminent(site: Site): boolean {
  if (site.stage !== 'construction' || isCompleted(site)) return false;
  const d = dday(site.dueDate);
  return d != null && d >= 0 && d <= 90;
}

/** 지난주 대비 이 현장에서 새로 생긴 줄 수 (볼 수 있는 부서 + 대표 지시). 지난주 기록이 없으면 null */
export function siteChanges(snap: Snapshot, siteId: string, deptIds: string[]): number | null {
  if (!snap.prevWeekId) return null;
  const written = has(siteDirective(snap.directives, siteId)?.content) || deptIds.some((d) => has(siteEntry(snap.entries, siteId, d)?.content));
  if (!written) return null;
  let n = changeCount(siteDirective(snap.directives, siteId)?.content, siteDirective(snap.prevDirectives, siteId)?.content);
  for (const d of deptIds) n += changeCount(siteEntry(snap.entries, siteId, d)?.content, siteEntry(snap.prevEntries, siteId, d)?.content);
  return n;
}

export function SiteCard({ site, snap, onOpen }: { site: Site; snap: Snapshot; onOpen(): void }) {
  const { me } = useStore();
  const depts = siteDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants));
  const directive = siteDirective(snap.directives, site.id);
  const due = dueInfo(site);
  const feedback = depts.reduce((n, d) => n + commentsFor(snap.comments, siteEntry(snap.entries, site.id, d.id)?.id).length, 0);
  const completed = site.stage === 'construction' && isCompleted(site);
  const changes = siteChanges(snap, site.id, depts.map((d) => d.id));

  return (
    <Card onClick={onOpen} className="flex h-full flex-col p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold leading-snug">{site.name}</h3>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{[site.note, site.process].filter(Boolean).join(' · ') || ' '}</p>
        </div>
        <StageChip stage={site.stage} />
      </div>

      <div className="mt-3">
        {site.progress != null ? (
          <div className="flex items-center gap-2.5">
            <Progress value={site.progress} />
            <span className={cx('w-12 shrink-0 whitespace-nowrap text-right text-[14px] font-bold tabular', completed ? 'text-ok' : 'text-ink')}>{site.progress}%</span>
          </div>
        ) : (
          <p className="text-[13px] font-semibold text-ink-2">{site.scale || '공정율 없음'}</p>
        )}
        <p className={cx('mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium tabular',
          due.tone === 'warn' ? 'text-warn' : due.tone === 'danger' ? 'text-danger' : due.tone === 'ok' ? 'text-ok' : 'text-ink-3')}>
          <CalendarClock size={13} />{due.label}
        </p>
      </div>

      {(site.tags.length > 0 || isImminent(site)) && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {isImminent(site) && <Badge tone="warn">준공임박</Badge>}
          {site.tags.map((t) => <Badge key={t} tone={t === '소송·분쟁' ? 'danger' : 'neutral'}>{t}</Badge>)}
        </div>
      )}

      {has(directive?.content) && (
        <p className="mt-3 line-clamp-2 whitespace-pre-line rounded-lg bg-note px-2.5 py-2 text-[12.5px] leading-[1.55] text-ink">
          <span className="mr-1 font-bold text-note-ink">지시</span>{firstLines(directive!.content, 2)}
        </p>
      )}

      <div className="mt-auto flex items-center gap-1.5 pt-3">
        {depts.map((d) => {
          const done = has(siteEntry(snap.entries, site.id, d.id)?.content);
          return (
            <span key={d.id} title={`${d.name} ${done ? '작성' : '미작성'}`}
              className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', done ? 'bg-brand-soft text-brand-ink' : 'bg-sunken text-ink-3')}>
              {d.name.replace(/사업부|부$/, '').split('/')[0]}
            </span>
          );
        })}
        <span className="ml-auto flex items-center gap-2.5">
          <PhotoCount count={snap.photos.filter((p) => p.siteId === site.id).length} />
          {feedback > 0 && <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink"><MessageSquareText size={13} />{feedback}</span>}
          {changes != null && (
            <span className={cx('text-[11.5px] font-semibold', changes ? 'text-brand-ink' : 'text-ink-3')}>{changes ? `변경 ${changes}줄` : '변동 없음'}</span>
          )}
        </span>
      </div>
    </Card>
  );
}
