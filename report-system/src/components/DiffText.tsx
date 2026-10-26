import { useState } from 'react';
import { has } from '../lib/derive';
import { lineDiff } from '../lib/diff';
import { useStore } from '../state/store';
import { Badge, cx, Segmented } from './ui';

/** 지난주 같은 칸과 비교해 새로 생긴 줄을 강조한다 */
export function DiffText({ text, prev, className, clamp, empty = '작성된 내용이 없습니다', badge = true }: {
  text: string | undefined;
  prev: string | undefined;
  className?: string;
  clamp?: number;
  empty?: string;
  badge?: boolean;
}) {
  const { snap, diffMode } = useStore();
  const [showRemoved, setShowRemoved] = useState(false);
  if (!has(text)) return <p className={cx('text-[13px] text-ink-3', className)}>{empty}</p>;
  const comparable = diffMode !== 'off' && !!snap?.prevWeekId;
  if (!comparable) {
    return <p className={cx('whitespace-pre-wrap text-[14px] leading-[1.7]', !!clamp && 'overflow-hidden', className)} style={clamp ? { WebkitLineClamp: clamp, display: '-webkit-box', WebkitBoxOrient: 'vertical' } : undefined}>{text}</p>;
  }
  const d = lineDiff(text!, prev);
  const only = diffMode === 'only' && !d.fresh;
  let hidden = 0;
  const rows: JSX.Element[] = [];
  d.lines.forEach((l, i) => {
    if (only && !l.added) { hidden++; return; }
    if (hidden) { rows.push(<p key={`h${i}`} className="text-[12px] text-ink-3">· 지난주와 같은 내용 {hidden}줄</p>); hidden = 0; }
    rows.push(
      <p key={i} className={cx('whitespace-pre-wrap', l.added && !d.fresh && 'rounded bg-brand-soft px-1 -mx-1 text-ink')}>{l.text || ' '}</p>,
    );
  });
  if (hidden) rows.push(<p key="tail" className="text-[12px] text-ink-3">· 지난주와 같은 내용 {hidden}줄</p>);

  return (
    <div className={className}>
      {badge && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {d.fresh ? <Badge tone="brand">이번 주 새로 작성</Badge>
            : d.same ? <Badge>지난주와 같음</Badge>
              : d.addedCount ? <Badge tone="brand">바뀐 줄 {d.addedCount}</Badge>
                : <Badge>새 줄 없음</Badge>}
          {d.removed.length > 0 && (
            <span role="button" tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setShowRemoved((v) => !v); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); setShowRemoved((v) => !v); } }}
              className="cursor-pointer text-[12px] font-semibold text-ink-3 hover:text-ink">
              빠진 내용 {d.removed.length}줄 {showRemoved ? '접기' : '보기'}
            </span>
          )}
        </div>
      )}
      <div className={cx('space-y-0 text-[14px] leading-[1.7]', !!clamp && 'overflow-hidden')} style={clamp ? { maxHeight: `${clamp * 1.7}em` } : undefined}>
        {only && d.same ? <p className="text-[13px] text-ink-3">지난주와 같은 내용입니다</p> : rows}
      </div>
      {showRemoved && (
        <div className="mt-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px] text-ink-3">
          {d.removed.map((r, i) => <p key={i} className="whitespace-pre-wrap line-through decoration-ink-3/50">{r}</p>)}
        </div>
      )}
    </div>
  );
}

/** 카드나 표에서 쓸 짧은 변경 요약 */
export function changeCount(text: string | undefined, prev: string | undefined): number {
  if (!has(text)) return 0;
  return lineDiff(text!, prev).addedCount;
}

export function DiffModeSwitch() {
  const { diffMode, setDiffMode, snap } = useStore();
  if (!snap?.prevWeekId) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12.5px] font-semibold text-ink-3">지난주 대비</span>
      <Segmented<typeof diffMode> value={diffMode} onChange={setDiffMode} options={[
        { id: 'highlight', label: '바뀐 줄 강조' },
        { id: 'only', label: '바뀐 줄만' },
        { id: 'off', label: '끄기' },
      ]} />
    </div>
  );
}
