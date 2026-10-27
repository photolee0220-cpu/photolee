import { ApiError } from './api';
import {
  has, memberDirective, miscDirective, miscEntry, personEntry, reporters, siteDepartments, siteDirective, siteEntry, visibleSites,
} from './derive';
import { lineDiff } from './diff';
import { STAGES, type Snapshot } from './types';

export interface SummaryResult {
  highlights: string[];
  siteChanges: { siteId: string; change: string }[];
}

export interface ChangedSite {
  siteId: string;
  addedLines: number;
}

/** 지난주 대비 새 줄이 생긴 현장 (지시사항 포함) */
export function changedSites(snap: Snapshot): ChangedSite[] {
  if (!snap.prevWeekId) return [];
  const depts = siteDepartments(snap);
  return visibleSites(snap).map((s) => {
    let n = 0;
    const d = siteDirective(snap.directives, s.id);
    if (has(d?.content)) n += lineDiff(d!.content, siteDirective(snap.prevDirectives, s.id)?.content).addedCount;
    for (const dp of depts) {
      const e = siteEntry(snap.entries, s.id, dp.id);
      if (has(e?.content)) n += lineDiff(e!.content, siteEntry(snap.prevEntries, s.id, dp.id)?.content).addedCount;
    }
    return { siteId: s.id, addedLines: n };
  }).filter((x) => x.addedLines > 0).sort((a, b) => b.addedLines - a.addedLines);
}

export function latestUpdate(snap: Snapshot): string {
  const times = [...snap.entries.map((e) => e.updatedAt), ...snap.directives.map((d) => d.updatedAt)].filter(Boolean).sort();
  return times[times.length - 1] ?? '';
}

const INSTRUCTIONS = `당신은 건설회사 대표에게 올라가는 주간보고를 정리하는 비서입니다. 아래 보고 전체를 읽고 지정한 JSON만 답하세요.

규칙
- highlights: 대표가 이번 주에 꼭 알아야 할 핵심 정확히 5가지. 한 항목은 한 문장, 70자 안쪽. 현장명·사람·금액·날짜를 구체적으로 쓰세요.
  우선순위: 돈(잔금, 대출, 계약, 공사비), 일정(착공·준공·지연), 법적 분쟁, 대표 결정이나 확인이 필요한 일, 안전.
  지난주 대비 바뀐 내용이 있으면 바뀐 내용을 먼저 고르세요.
- siteChanges: "지난주 대비 바뀐 현장" 목록에 있는 현장마다 무엇이 달라졌는지 한 문장(60자 안쪽). siteId는 목록의 값을 그대로 쓰세요. 목록이 비어 있으면 빈 배열.
- 보고에 없는 내용을 지어내지 마세요. 확실하지 않으면 빼세요.
- 문체는 간결한 보고체(~함, ~예정, ~필요)로 쓰세요.

답 형식 (JSON 하나만):
{"highlights": ["...", "...", "...", "...", "..."], "siteChanges": [{"siteId": "...", "change": "..."}]}`;

/** 요약에 넣을 보고 전문. 화면에 보이는 범위(대표는 전체)만 담긴다 */
export function buildSummaryPrompt(snap: Snapshot): { prompt: string; changed: ChangedSite[]; sourceUpdatedAt: string } {
  const depts = siteDepartments(snap);
  const changed = changedSites(snap);
  const changedIds = new Set(changed.map((c) => c.siteId));
  const out: string[] = [INSTRUCTIONS, '', '---', `# 주간보고 (보고일 ${snap.weekId}${snap.prevWeekId ? `, 비교 대상 ${snap.prevWeekId}` : ', 지난주 기록 없음'})`];

  const cell = (label: string, text: string | undefined, prev: string | undefined) => {
    if (!has(text)) return;
    out.push(`${label}: ${text!.trim().replace(/\n/g, '\n  ')}`);
    if (snap.prevWeekId) {
      const d = lineDiff(text!, prev);
      if (d.fresh) out.push('  (이번 주 새로 작성)');
      else if (d.addedCount) out.push(`  (지난주 대비 새로 쓴 줄: ${d.lines.filter((l) => l.added).map((l) => l.text.trim()).join(' / ')})`);
    }
  };

  const special = miscDirective(snap.directives, 'special');
  if (has(special?.content)) out.push('', '## 주간 특별 지시사항', special!.content.trim());

  out.push('', `## 지난주 대비 바뀐 현장 (siteId 목록)`, changed.length ? changed.map((c) => c.siteId).join(', ') : '(없음)');

  for (const st of STAGES) {
    const list = visibleSites(snap).filter((s) => s.stage === st.id);
    if (!list.length) continue;
    out.push('', `## ${st.label}`);
    for (const s of list) {
      const meta = [s.process, s.progress != null ? `공정율 ${s.progress}%` : s.scale, s.dueDate ? `${st.id === 'construction' ? '준공' : '착공'}예상 ${s.dueDate}` : s.dueText, s.tags.join('·')].filter(Boolean).join(' | ');
      out.push('', `### [${s.id}] ${s.name}${s.note ? ` (${s.note})` : ''}${changedIds.has(s.id) ? ' *바뀜*' : ''}`, meta);
      cell('대표 지시', siteDirective(snap.directives, s.id)?.content, siteDirective(snap.prevDirectives, s.id)?.content);
      for (const d of depts) cell(d.name, siteEntry(snap.entries, s.id, d.id)?.content, siteEntry(snap.prevEntries, s.id, d.id)?.content);
    }
  }

  const misc = depts.map((d) => [d.name, miscEntry(snap.entries, d.id)?.content, miscEntry(snap.prevEntries, d.id)?.content] as const).filter(([, t]) => has(t));
  if (misc.length || has(miscDirective(snap.directives, 'ceo_progress')?.content)) {
    out.push('', '## 기타사항');
    cell('대표 진행사항', miscDirective(snap.directives, 'ceo_progress')?.content, miscDirective(snap.prevDirectives, 'ceo_progress')?.content);
    cell('의뢰 진행', miscDirective(snap.directives, 'requests')?.content, miscDirective(snap.prevDirectives, 'requests')?.content);
    for (const [name, t, p] of misc) cell(name, t, p);
  }

  out.push('', '## 부서별 보고');
  for (const m of reporters(snap)) {
    const e = personEntry(snap.entries, m.id);
    const dv = memberDirective(snap.directives, m.id);
    if (!has(e?.content) && !has(dv?.content)) continue;
    const dept = snap.departments.find((d) => d.id === m.departmentId)?.name ?? '';
    out.push('', `### ${m.name} ${m.title} (${dept})`);
    cell('대표 지시', dv?.content, memberDirective(snap.prevDirectives, m.id)?.content);
    cell('업무', e?.content, personEntry(snap.prevEntries, m.id)?.content);
  }

  return { prompt: out.join('\n'), changed, sourceUpdatedAt: latestUpdate(snap) };
}

export function parseSummary(value: unknown): SummaryResult {
  const v = value as Partial<SummaryResult> | null;
  const highlights = Array.isArray(v?.highlights) ? v!.highlights.map(String).filter(Boolean).slice(0, 5) : [];
  const siteChanges = Array.isArray(v?.siteChanges)
    ? v!.siteChanges.filter((x) => x && typeof x === 'object').map((x) => ({ siteId: String(x.siteId), change: String(x.change) }))
    : [];
  if (!highlights.length) throw new ApiError('요약 결과를 읽지 못했습니다. 다시 만들어 주세요.');
  return { highlights, siteChanges };
}

type SampleFn = { json(input: string, opts?: Record<string, unknown>): Promise<unknown> };

/** 체험판(Claude 아티팩트)에서는 보는 사람의 Claude로 요약한다 */
export async function askClaudeForSummary(prompt: string, model: { id: string; tier: string }): Promise<SummaryResult> {
  const host = (window as unknown as { claude?: { use?(n: string): Promise<unknown> } }).claude;
  const sample = host?.use ? ((await host.use('sample').catch(() => null)) as SampleFn | null) : null;
  if (!sample) throw new ApiError('체험판에서는 Claude 안에서 열었을 때만 AI 요약을 만들 수 있습니다. 실제 서버에서는 대표님 화면에서 바로 됩니다.');
  try {
    return parseSummary(await sample.json(prompt, { model: model.id, modelTier: model.tier, cache: false }));
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'not_granted' || code === 'sampling_disabled') throw new ApiError('Claude 사용이 허용되지 않아 요약을 만들 수 없습니다.');
    if (code === 'rate_limited') throw new ApiError('Claude 사용량이 많아 잠시 후 다시 시도해 주세요.');
    if (e instanceof ApiError) throw e;
    throw new ApiError('요약을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
