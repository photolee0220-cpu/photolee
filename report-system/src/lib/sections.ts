/**
 * 대주제별 보고. 저장은 일반 글로 하고 "■ 제목" 줄이 대주제의 시작이다.
 * 제목 없는 첫 덩어리는 기존처럼 그냥 글로 남는다.
 */
export interface Section {
  title: string;
  body: string;
}

const HEADING = /^■(?: (.*))?$/;

export function isHeading(line: string): boolean {
  return HEADING.test(line);
}

export function headingText(line: string): string {
  return (line.match(HEADING)?.[1] ?? '').trim();
}

function trimBlankEdges(lines: string[]): string {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).join('\n');
}

export function parseSections(text: string | null | undefined): Section[] {
  const out: { title: string; lines: string[]; titled: boolean }[] = [];
  let cur = { title: '', lines: [] as string[], titled: false };
  out.push(cur);
  for (const line of (text ?? '').split('\n')) {
    if (isHeading(line)) {
      cur = { title: headingText(line), lines: [], titled: true };
      out.push(cur);
    } else {
      cur.lines.push(line);
    }
  }
  const sections = out
    .map((s) => ({ title: s.title, body: trimBlankEdges(s.lines), titled: s.titled }))
    .filter((s, i) => i > 0 || s.body || out.length === 1);
  return sections.length ? sections.map(({ title, body }) => ({ title, body })) : [{ title: '', body: '' }];
}

export function serializeSections(sections: Section[]): string {
  return sections
    .map((s, i) => (i === 0 && !s.title.trim() ? s.body : `■ ${s.title.trim()}\n${s.body}`.replace(/^■ \n/, '■\n')))
    .join('\n\n')
    .replace(/^(\s*\n)+/, '')
    .replace(/\s+$/, '');
}

export function hasSections(text: string | null | undefined): boolean {
  return (text ?? '').split('\n').some(isHeading);
}
