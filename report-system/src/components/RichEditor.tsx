import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { parseLine, type Mark } from '../lib/marks';
import { cx } from './ui';

/**
 * 강조가 바로 보이는 입력 칸. 화면에서는 굵게·색으로 보이고, 저장은 지금처럼
 * [b]…[/b] 같은 표시가 든 글로 한다(다른 화면·엑셀·AI가 같은 글을 읽는다).
 */
export interface RichEditorHandle {
  applyMark(mark: Mark): void;
  focus(): void;
}

const MARK_CLASS: Record<Mark, string> = {
  b: 'font-bold',
  red: 'font-semibold text-em-red',
  blue: 'font-semibold text-em-blue',
  hl: 'rounded-[3px] bg-em-hl text-ink',
};
const ZW = '​';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 저장된 글 → 입력 칸 HTML */
function toHtml(text: string): string {
  const lines = text.split('\n').map((line) => parseLine(line).map((r) => {
    let html = esc(r.text);
    for (const m of [...r.marks].reverse()) html = `<span data-m="${m}" class="${MARK_CLASS[m]}">${html}</span>`;
    return html;
  }).join(''));
  // 끝이 줄바꿈이면 커서가 새 줄에 설 수 있게 표시용 <br>을 하나 더 둔다
  return lines.join('<br>') + (text.endsWith('\n') || text === '' ? '<br data-end="1">' : '');
}

/** 입력 칸 HTML → 저장할 글. 줄을 넘는 강조는 줄마다 닫고 다시 연다 */
function toText(root: HTMLElement): string {
  let out = '';
  // 맨 끝의 <br>은 브라우저가 커서 자리로 넣는 것이라 글에 넣지 않는다
  let tail: Node | null = root;
  while (tail && tail.lastChild) tail = tail.lastChild;
  const tailBr = tail instanceof HTMLElement && tail.tagName === 'BR' ? tail : null;
  const stack: Mark[] = [];
  const newline = () => {
    for (let i = stack.length - 1; i >= 0; i--) out += `[/${stack[i]}]`;
    out += '\n';
    for (const m of stack) out += `[${m}]`;
  };
  const markOf = (el: HTMLElement): Mark | null => {
    const m = el.dataset.m as Mark | undefined;
    if (m) return m;
    if (el.tagName === 'B' || el.tagName === 'STRONG') return 'b';
    return null;
  };
  const walk = (node: Node, first: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parts = (node.textContent ?? '').replace(new RegExp(ZW, 'g'), '').split('\n');
      parts.forEach((p, i) => { if (i > 0) newline(); out += p; });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') { if (!node.dataset.end && node !== tailBr) newline(); return; }
    // 브라우저가 줄바꿈을 <div>로 만드는 경우
    const block = node !== root && (node.tagName === 'DIV' || node.tagName === 'P');
    if (block && !first) newline();
    const m = node === root ? null : markOf(node);
    if (m) { out += `[${m}]`; stack.push(m); }
    node.childNodes.forEach((c, i) => walk(c, i === 0 && (first || !block)));
    if (m) { stack.pop(); out += `[/${m}]`; }
  };
  walk(root, true);
  // 비어 있는 강조 표시와 끝의 군더더기 정리
  return out.replace(/\[(b|red|blue|hl)\]\[\/\1\]/g, '');
}

export const RichEditor = forwardRef<RichEditorHandle, {
  value: string;
  onChange(text: string): void;
  onFocus?(): void;
  onBlur?(): void;
  placeholder?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
  onSubmit?(): void;
}>(function RichEditor({ value, onChange, onFocus, onBlur, placeholder, className, id, ariaLabel, onSubmit }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);

  // 밖에서 글이 바뀌었을 때만(지난주 불러오기, 다른 사람 수정 등) 다시 그린다. 내가 친 글은 그대로 둔다
  useEffect(() => {
    if (!el.current || value === last.current) return;
    el.current.innerHTML = toHtml(value);
    last.current = value;
  }, [value]);

  const emit = () => {
    if (!el.current) return;
    const text = toText(el.current);
    last.current = text;
    onChange(text);
  };

  const applyMark = (mark: Mark) => {
    const root = el.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const closest = (n: Node | null): HTMLElement | null => {
      for (let x: Node | null = n; x && x !== root; x = x.parentNode) if (x instanceof HTMLElement && (x.dataset.m === mark || (mark === 'b' && (x.tagName === 'B' || x.tagName === 'STRONG')))) return x;
      return null;
    };
    const own = closest(range.startContainer);
    if (own && own === closest(range.endContainer)) {
      // 이미 같은 강조 안이면 풀기
      const parent = own.parentNode!;
      while (own.firstChild) parent.insertBefore(own.firstChild, own);
      parent.removeChild(own);
    } else {
      const span = document.createElement('span');
      span.dataset.m = mark;
      span.className = MARK_CLASS[mark];
      if (range.collapsed) {
        // 선택 없이 누르면 지금 자리부터 강조해서 쓰기 시작
        span.textContent = ZW;
        range.insertNode(span);
        const r = document.createRange();
        r.setStart(span.firstChild!, 1);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } else {
        span.appendChild(range.extractContents());
        range.insertNode(span);
        // 줄 끝에 강조를 넣었으면 뒤에 빈 글자 자리를 둬서, 이어 치는 글은 강조 밖으로 나가게 한다
        let next = span.nextSibling;
        while (next && next.nodeType === Node.TEXT_NODE && !next.textContent) { const empty = next; next = next.nextSibling; empty.remove(); }
        if (!next || (next instanceof HTMLElement && next.tagName === 'BR')) span.after(document.createTextNode(ZW));
        const r = document.createRange();
        r.selectNodeContents(span);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    emit();
  };

  useImperativeHandle(ref, () => ({ applyMark, focus: () => el.current?.focus() }));

  return (
    <div className="relative">
      {!value && placeholder && <div className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap text-ink-3" aria-hidden><div className={cx(className, '!border-transparent !bg-transparent !shadow-none !ring-0')}>{placeholder}</div></div>}
      <div
        ref={el}
        id={id}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel ?? placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); return; }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); document.execCommand('insertLineBreak'); emit(); return; }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); applyMark('b'); }
        }}
        onPaste={(e) => {
          // 다른 곳 서식은 빼고 글만 붙인다
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className={cx('whitespace-pre-wrap break-words outline-none', className)}
      />
    </div>
  );
});
