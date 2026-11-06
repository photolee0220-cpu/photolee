/**
 * 글자 강조. 글 안에 짧은 표시로 저장한다: [b]굵게[/b] [red]빨강[/red] [blue]파랑[/blue] [hl]형광펜[/hl]
 * 한 줄 안에서만 적용되고, 닫히지 않은 표시는 그 줄 끝에서 닫힌 것으로 본다.
 */
export type Mark = 'b' | 'red' | 'blue' | 'hl';
export const MARKS: Mark[] = ['b', 'red', 'blue', 'hl'];

const TAG = /\[(\/?)(b|red|blue|hl)\]/g;

export interface Run {
  text: string;
  marks: Mark[];
}

/** 한 줄을 강조 단위로 나눈다 */
export function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  const active: Mark[] = [];
  let last = 0;
  const push = (text: string) => { if (text) runs.push({ text, marks: [...active] }); };
  for (const m of line.matchAll(TAG)) {
    push(line.slice(last, m.index));
    last = m.index! + m[0].length;
    const mark = m[2] as Mark;
    if (m[1]) { const i = active.lastIndexOf(mark); if (i >= 0) active.splice(i, 1); } else if (!active.includes(mark)) active.push(mark);
  }
  push(line.slice(last));
  return runs;
}

export function hasMarks(text: string | null | undefined): boolean {
  return !!text && /\[\/?(b|red|blue|hl)\]/.test(text);
}

/** 강조 표시를 지운 글 (AI 요약, 미리보기 한 줄, 검색 등) */
export function stripMarks(text: string): string {
  return text.replace(TAG, '');
}

/**
 * 선택한 부분에 강조를 넣거나(이미 같은 강조면 뺀다) 결과 글과 새 선택 범위를 돌려준다.
 * 여러 줄을 고르면 줄마다 따로 감싼다.
 */
export function toggleMark(text: string, start: number, end: number, mark: Mark): { text: string; start: number; end: number } {
  const open = `[${mark}]`;
  const close = `[/${mark}]`;
  // 바로 바깥이 같은 표시로 감싸여 있으면 풀기
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close) {
    const t = text.slice(0, start - open.length) + text.slice(start, end) + text.slice(end + close.length);
    return { text: t, start: start - open.length, end: end - open.length };
  }
  const sel = text.slice(start, end);
  // 선택 안쪽이 통째로 감싸여 있으면 풀기
  if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  if (!sel) {
    const t = text.slice(0, start) + open + close + text.slice(end);
    return { text: t, start: start + open.length, end: start + open.length };
  }
  const wrapped = sel.split('\n').map((l) => (l.trim() ? `${open}${l}${close}` : l)).join('\n');
  return { text: text.slice(0, start) + wrapped + text.slice(end), start, end: start + wrapped.length };
}
