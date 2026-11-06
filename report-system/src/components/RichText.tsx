import { Bold, Highlighter } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { hasMarks, parseLine, type Mark } from '../lib/marks';
import { cx } from './ui';

const STYLE: Record<Mark, string> = {
  b: 'font-bold',
  red: 'font-semibold text-em-red',
  blue: 'font-semibold text-em-blue',
  hl: 'rounded-[3px] bg-em-hl px-0.5 text-ink',
};

/** 한 줄의 강조를 적용해 그린다 */
export function renderInline(line: string): ReactNode {
  if (!hasMarks(line)) return line;
  return parseLine(line).map((r, i) => (r.marks.length ? <span key={i} className={cx(...r.marks.map((m) => STYLE[m]))}>{r.text}</span> : <Fragment key={i}>{r.text}</Fragment>));
}

/** 여러 줄 글을 강조와 함께 그린다 (줄바꿈은 바깥의 whitespace-pre-wrap이 처리) */
export function RichLines({ text }: { text: string }) {
  if (!hasMarks(text)) return <>{text}</>;
  const lines = text.split('\n');
  return <>{lines.map((l, i) => <Fragment key={i}>{renderInline(l)}{i < lines.length - 1 && '\n'}</Fragment>)}</>;
}

const BUTTONS: { mark: Mark; label: string; icon: ReactNode }[] = [
  { mark: 'b', label: '굵게', icon: <Bold size={14} strokeWidth={2.6} /> },
  { mark: 'red', label: '빨간 글씨 (문제·위험)', icon: <span className="text-[13px] font-extrabold text-em-red">가</span> },
  { mark: 'blue', label: '파란 글씨 (완료·좋은 소식)', icon: <span className="text-[13px] font-extrabold text-em-blue">가</span> },
  { mark: 'hl', label: '형광펜 (결정 필요)', icon: <Highlighter size={14} /> },
];

/** 강조 버튼 줄. 글자를 선택하고 누르면 강조, 다시 누르면 풀린다 */
export function MarkToolbar({ onApply, className }: { onApply(mark: Mark): void; className?: string }) {
  return (
    <div className={cx('flex items-center gap-0.5', className)} role="toolbar" aria-label="글자 강조">
      {BUTTONS.map((b) => (
        <button key={b.mark} type="button" title={b.label} aria-label={b.label}
          // 버튼을 눌러도 입력 칸의 선택이 풀리지 않게
          onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => onApply(b.mark)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
          {b.icon}
        </button>
      ))}
    </div>
  );
}

/** 강조가 들어간 글이면 입력 칸 아래에 보이는 모습을 미리 보여준다 */
export function MarkPreview({ text, className }: { text: string; className?: string }) {
  if (!hasMarks(text)) return null;
  return (
    <div className={cx('mt-1.5 rounded-lg border border-dashed border-line-strong bg-sunken/60 px-3 py-2', className)}>
      <p className="mb-0.5 text-[11.5px] font-semibold text-ink-3">미리보기</p>
      <p className="whitespace-pre-wrap text-[13.5px] leading-[1.65] text-ink"><RichLines text={text} /></p>
    </div>
  );
}
