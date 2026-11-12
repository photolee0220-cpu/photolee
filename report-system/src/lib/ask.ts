import { stripMarks } from './marks';
import type { Department, Member, SearchDoc, Site } from './types';

/** 대표님 검색: 보고 원문에서 찾고, AI에게는 근거가 될 보고만 번호를 붙여 보낸다 */

export interface Labeled extends SearchDoc {
  /** AI와 화면에서 쓰는 짧은 번호 (S1, S2 …) */
  ref: string;
  label: string;
  score: number;
}

export interface Lookup {
  sites: Map<string, Site>;
  members: Map<string, Member>;
  departments: Map<string, Department>;
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export function docLabel(d: SearchDoc, l: Lookup): string {
  const site = d.siteId ? l.sites.get(d.siteId)?.name : '';
  const m = d.memberId ? l.members.get(d.memberId) : undefined;
  const dept = d.departmentId ? l.departments.get(d.departmentId)?.name : '';
  const who = m ? `${m.name} ${m.title}`.trim() : '';
  if (d.kind === 'daily') return `일일 ${md(d.date)} · ${[who, dept].filter(Boolean).join(' · ')}${site ? ` · ${site}` : ''}`;
  if (d.kind === 'directive') return `대표 지시 · ${md(d.date)} 보고 · ${site || who} · 처리 ${d.status === 'done' ? '완료' : d.status === 'doing' ? '진행 중' : '대기'}`;
  return `주간 ${md(d.date)} 보고 · ${site ? `${site} · ${dept}` : `${who}${dept ? ` (${dept})` : ''}`}`;
}

// 질문에 흔히 붙는 말은 검색어에서 뺀다
const STOP = new Set(['정리', '정리해줘', '정리해', '알려줘', '알려', '해줘', '내용', '관련', '관련된', '이번', '지난', '최근', '요약', '요약해줘', '뭐', '무엇', '어떻게', '있어', '있는', '됐어', '했어', '어디', '누가', '언제', '보고', '현황', '상황', '주', '달', '좀', '것', '거', '중', '및']);
const PARTICLE = /(으로|에서|까지|부터|에게|한테|이랑|하고|은|는|이|가|을|를|에|의|도|로|와|과|랑|만)$/;

export function queryTerms(q: string): string[] {
  const out = new Set<string>();
  for (const raw of q.split(/[\s,.?!·/()"'~]+/)) {
    let w = raw.trim();
    if (!w) continue;
    if (w.length > 2) w = w.replace(PARTICLE, '');
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(w);
  }
  return [...out];
}

/** 점수: 검색어가 글·제목에 나온 횟수 + 질문에 현장명·사람 이름이 있으면 그 보고를 크게 올린다 */
export function rank(docs: SearchDoc[], q: string, l: Lookup): Labeled[] {
  const terms = queryTerms(q);
  const siteHits = new Set([...l.sites.values()].filter((s) => q.includes(s.name) || (s.name.length > 4 && q.includes(s.name.slice(0, 4)))).map((s) => s.id));
  const memberHits = new Set([...l.members.values()].filter((m) => m.name.length >= 2 && q.includes(m.name)).map((m) => m.id));
  const deptHits = new Set([...l.departments.values()].filter((d) => q.includes(d.name)).map((d) => d.id));
  return docs.map((d, i) => {
    const label = docLabel(d, l);
    const text = `${label}\n${stripMarks(d.content)}`;
    let score = 0;
    for (const t of terms) {
      let n = 0;
      for (let at = text.indexOf(t); at >= 0 && n < 5; at = text.indexOf(t, at + t.length)) n++;
      score += n;
    }
    if (d.siteId && siteHits.has(d.siteId)) score += 6;
    if (d.memberId && memberHits.has(d.memberId)) score += 6;
    if (d.departmentId && deptHits.has(d.departmentId)) score += 3;
    return { ...d, ref: `S${i + 1}`, label, score };
  });
}

/** AI에게 보낼 글. 기간 안 보고가 적으면 모두, 많으면 관련 높은 것부터 한도까지 */
const BUDGET = 150_000;

export function buildAskPrompt(question: string, ranked: Labeled[], periodLabel: string): { prompt: string; sent: Labeled[]; partial: boolean } {
  const body = (d: Labeled) => `[${d.ref}] ${d.label}\n${stripMarks(d.content).trim()}`;
  const total = ranked.reduce((n, d) => n + d.content.length + d.label.length + 10, 0);
  let sent: Labeled[];
  let partial = false;
  if (total <= BUDGET) {
    sent = [...ranked].sort((a, b) => b.date.localeCompare(a.date));
  } else {
    partial = true;
    const order = [...ranked].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
    sent = [];
    let n = 0;
    for (const d of order) {
      const size = d.content.length + d.label.length + 10;
      if (n + size > BUDGET) continue;
      sent.push(d);
      n += size;
    }
    sent.sort((a, b) => b.date.localeCompare(a.date));
  }
  const prompt = [
    '당신은 건설회사 대표님의 업무 비서입니다. 아래 [보고] 목록만 근거로 대표님 질문에 답하세요.',
    '규칙',
    '- 보고에 없는 내용은 지어내지 말고, 근거가 없으면 "보고에서 찾지 못했습니다"라고 답하세요.',
    '- 답은 간결한 보고체(~함, ~예정, ~필요)로, 한 줄에 한 가지씩 "- "로 시작하는 목록으로 쓰세요. 필요하면 맨 위에 한 줄 결론을 먼저 쓰세요.',
    '- 각 줄 끝에 근거 보고 번호를 [S3]처럼 붙이세요. 여러 개면 [S3][S7].',
    '- 날짜·현장·사람·금액은 구체적으로 쓰세요. 최근 내용과 예전 내용이 다르면 최근 것을 기준으로 하고 바뀐 점을 말하세요.',
    '- sourceIds에는 답에 쓴 보고 번호만 넣으세요.',
    partial ? '- 보고가 많아 질문과 관련 높은 것만 골라 보냈습니다.' : '',
    '',
    `[질문] ${question}`,
    `[기간] ${periodLabel}`,
    '',
    '[보고]',
    ...sent.map(body),
  ].filter((x) => x !== '').join('\n');
  return { prompt, sent, partial };
}

/** 답 글에서 [S3] 같은 근거 표시를 찾아 나눈다 */
export function splitRefs(line: string): (string | { ref: string })[] {
  const out: (string | { ref: string })[] = [];
  let last = 0;
  for (const m of line.matchAll(/\[(S\d+)\]/g)) {
    if (m.index! > last) out.push(line.slice(last, m.index));
    out.push({ ref: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** 검색어가 들어간 곳 주변만 짧게 */
export function snippet(text: string, terms: string[], size = 120): string {
  const plain = stripMarks(text).replace(/\s+/g, ' ').trim();
  const at = terms.map((t) => plain.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 30);
  return `${start > 0 ? '…' : ''}${plain.slice(start, start + size)}${start + size < plain.length ? '…' : ''}`;
}
