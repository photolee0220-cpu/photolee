// 대표 전용: 이번 주 보고를 Claude로 요약해 저장한다 (모델은 app_settings.summary_model)
// mode: 'site' 이면 현장 하나의 여러 달 기록을 요약한다 (대표·관리자)
// mode: 'ask' 이면 대표님 질문에 보고 원문(화면에서 골라 보낸 것)만 근거로 답한다 (저장하지 않음)
// mode: 'safety' 이면 현장 보고에서 찾은 위험 작업으로 대표님 안전 당부 초안을 쓴다 (대표)
// mode: 'ocr' 이면 글자가 없는 현장 자료(스캔 PDF·사진)를 읽어 글자를 저장한다 (올린 사람·대표·관리자)
// 배포: supabase functions deploy weekly-summary
// 비밀값: supabase secrets set ANTHROPIC_API_KEY=...
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

/* ───────────── AI 월 예산 ───────────── */
// 100만 토큰당 달러 (입력, 출력). 배치는 절반. 생각(thinking) 토큰은 출력에 포함되어 청구된다
const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50], 'claude-sonnet-5-5': [2, 10], 'claude-sonnet-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-opus-5': [5, 25], 'claude-opus-4-8': [5, 25],
};
const priceOf = (model: string) => PRICES[model] ?? PRICES[Object.keys(PRICES).find((k) => model.startsWith(k)) ?? ''] ?? [5, 25];
function costUsd(model: string, input: number, output: number, batch = false): number {
  let [pi, po] = priceOf(model);
  if (model.startsWith('claude-haiku-5-5') && input > 100_000) { pi = 0.5; po = 2.5; }
  return ((input * pi + output * po) / 1e6) * (batch ? 0.5 : 1);
}
// deno-lint-ignore no-explicit-any
async function budgetState(service: any): Promise<{ capUsd: number; spentUsd: number; krwPerUsd: number }> {
  const { data: b } = await service.from('app_settings').select('value').eq('key', 'ai_budget').maybeSingle();
  const krwPerUsd = Number(b?.value?.krwPerUsd) > 0 ? Number(b.value.krwPerUsd) : 1400;
  const capUsd = (Number(b?.value?.monthlyKrw) >= 0 && b?.value?.monthlyKrw != null ? Number(b.value.monthlyKrw) : 10000) / krwPerUsd;
  // 이번 달 (한국 시간 1일 0시부터)
  const kst = new Date(Date.now() + 9 * 3600000);
  const monthStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - 9 * 3600000).toISOString();
  const { data: rows } = await service.from('ai_usage').select('cost_usd').gte('at', monthStart);
  const spentUsd = (rows ?? []).reduce((n: number, r: { cost_usd: number }) => n + Number(r.cost_usd), 0);
  return { capUsd, spentUsd, krwPerUsd };
}
// deno-lint-ignore no-explicit-any
async function recordUsage(service: any, feature: string, model: string, usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined, batch = false, units = 1, ref: string | null = null) {
  const input = Number(usage?.input_tokens ?? 0) + Number(usage?.cache_creation_input_tokens ?? 0) + Number(usage?.cache_read_input_tokens ?? 0) * 0.1;
  const output = Number(usage?.output_tokens ?? 0);
  await service.from('ai_usage').insert({ feature, model, input_tokens: Math.round(input), output_tokens: output, batch, units, cost_usd: costUsd(model, input, output, batch), ref });
}
const won = (usd: number, rate: number) => `${Math.round(usd * rate).toLocaleString('ko-KR')}원`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['highlights', 'siteChanges'],
  properties: {
    highlights: { type: 'array', items: { type: 'string' } },
    siteChanges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['siteId', 'change'],
        properties: { siteId: { type: 'string' }, change: { type: 'string' } },
      },
    },
  },
};

const SITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'milestones', 'issues'],
  properties: {
    overview: { type: 'string' },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['weekId', 'text'],
        properties: { weekId: { type: 'string' }, text: { type: 'string' } },
      },
    },
    issues: { type: 'array', items: { type: 'string' } },
  },
};

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'sourceIds'],
  properties: {
    answer: { type: 'string' },
    sourceIds: { type: 'array', items: { type: 'string' } },
  },
};

const SAFETY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tips'],
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['siteId', 'text'],
        properties: { siteId: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
};

/* ───────────── 업무 분석 (mode 'workmap' / 'workmap-collect') ───────────── */
// 경영 컨설턴트 수준의 부서 업무 분석. 한 주(보고일 월요일 W: W-7 ~ W-1 일일보고 + W 주차 주간보고)를
// 부서마다 한 요청으로 만들어 Message Batches로 보낸다 (시간 제한 없음, 요금 절반).
// 결과는 'workmap-collect'가 모아 저장한다 (5분마다 예약 작업 + 화면이 기다리는 동안).
// 사람 이름은 AI에 보내지 않는다. 찐관리자(admin 계정) 또는 예약 작업(비밀값)만 부를 수 있다.

// deno-lint-ignore no-explicit-any
type Db = SupabaseClient<any, 'public', any>;
const WORKMAP_MODEL = 'claude-opus-5-5';

const S = { type: 'string' };
const N = { type: 'number' };
const I = { type: 'integer' };
const SA = { type: 'array', items: S };
const GRADE = { type: 'string', enum: ['low', 'mid', 'high'] };
const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });

const WORKMAP_SCHEMA = obj({
  summary: S,
  replaceRate: I,
  hoursObserved: N,
  hoursSavable: N,
  categories: { type: 'array', items: obj({ name: S, count: I, share: I, examples: SA }) },
  tasks: { type: 'array', items: obj({
    task: S, category: S, times: I, evidence: S, tools: SA, output: S, hoursPerWeek: N,
    replaceability: { type: 'string', enum: ['full', 'partial', 'human'] }, score: I, reason: S,
  }) },
  recurring: { type: 'array', items: obj({ task: S, times: I, note: S }) },
  issues: { type: 'array', items: obj({ finding: S, evidence: S, impact: S }) },
  ideas: { type: 'array', items: obj({
    task: S, title: S, level: { type: 'string', enum: ['replace', 'assist', 'human'] },
    approach: { type: 'string', enum: ['system', 'external', 'process'] },
    asIs: S, toBe: S, how: S, system: S, toolPrompt: S, steps: SA,
    hoursSaved: N, savingsBasis: S, errorReduction: S, effort: GRADE, impact: GRADE, risks: S, kpi: S,
  }) },
  humanTasks: { type: 'array', items: obj({ task: S, reason: S }) },
  ceoPoints: SA,
  questions: SA,
});

const WORKMAP_SYSTEM = `당신은 건설업 전문 경영 컨설턴트이자 업무 자동화(AI 전환) 설계자입니다.
고객사는 교회 건축을 전문으로 하는 종합건설사(사닥다리종합건설)입니다. 경영진(관리자)이 부서마다 "실제로 무슨 일을 하는지" 파악하고,
그중 AI로 대체하거나 자동화할 수 있는 일을 찾아 실제로 바꾸려고 합니다. 당신의 분석은 그대로 경영진 보고서와 시스템 개발 계획에 쓰입니다.

## 고객사 상황
- 업종 맥락: 종합건설(원도급), 교회 신축·리모델링, 건축주(교회) 상담·설계·견적·시공·감리 대응·기성·준공. 한국 건설 실무(공사일보, 기성 청구·검토, 하도급, 감리 지적, 안전관리계획서, 산업안전보건법, 자재 발주·수급)를 전제로 생각하세요.
- 직원들이 쓰는 도구: 엑셀·한글·워드(견적, 기성, 공문, 보고서), 카카오톡·문자(현장·협력업체 연락), ERP·회계 프로그램(더존 등), 캐드·설계 프로그램(도면, 3D).
- 사내 업무보고 시스템(웹·휴대폰 앱, 관리자가 직접 기능을 추가 개발함. Claude API를 이미 연결해 씀)에 있는 것:
  일일보고(현장 사진 포함), 주간 부서보고·현장별 보고, 대표 지시사항·처리 상태, 캘린더, 소통(부서·현장 채팅방, 전체 공지, 신규 교회건축 문의방과 문의 카드, 안전방),
  자료실(회의록·공사일보·공정표 PDF 보관과 내용 검색, 전체 사진·파일 모아 보기), AI 기능(대표 질문 검색, 안전 당부 초안, 스캔 PDF 글자 읽기), 내 메모(할 일 알림), 푸시 알림, 예약 작업(정해진 시간 자동 실행).
  → 시스템 개발안은 이 위에 붙일 수 있는 것으로, 위 기능과 Claude API(문서·사진 읽기, 초안 작성, 분류, 요약, 대조)·예약 작업·알림을 조합해 설계하세요.

## 경영진의 목표 (우선순위 순)
1. AI로 대체할 수 있는 업무를 최대한 찾아 실제로 대체한다 (대체 가능성 검토가 1순위)
2. 반복 업무 시간을 줄인다
3. 실수·누락을 줄인다 (기성·견적·안전처럼 틀리면 손해가 큰 일)
4. 대표님이 현황과 리스크를 빨리 파악해 결정하도록 돕는다

## 분석 원칙
- 근거 우선: 모든 판단은 보고에 실제로 적힌 문장에 근거합니다. evidence에는 보고 원문을 짧게 그대로 인용하세요("…"). 보고에 없는 일은 만들어 내지 마세요.
- 추상어 금지: "효율화", "자동화 검토", "AI 활용", "체계화", "디지털 전환" 같은 말만 쓰지 마세요. 항상 "무엇을(어떤 문서·데이터를), 무엇으로(어떤 도구·기능), 누가, 언제, 결과물이 무엇인지"를 씁니다.
  나쁜 예: "견적 업무에 AI를 활용해 효율화"
  좋은 예: "협력업체 3곳의 견적서(PDF·엑셀)를 자료실에 올리면 Claude가 공종·규격·수량·단가를 읽어 항목별 비교표(엑셀)를 만들고, 최저가 대비 15% 이상 차이 나는 항목과 누락 항목을 빨간색으로 표시 → 담당자는 표시된 줄만 확인"
- 대체 가능성은 냉정하게: 서류 작성·옮겨 적기·대조·정리·요약·분류·일정 계산·반복 안내는 AI가 대신할 수 있는지 먼저 검토하고(full), 판단은 사람이 하되 준비를 AI가 하는 일은 partial, 법적 책임·서명, 현장 지휘와 위험 판단, 건축주·협력업체와의 신뢰·협상, 최종 금액 결정은 human으로 둡니다. human인 이유를 분명히 씁니다.
- 수치 추정: 시간(hoursPerWeek, hoursSaved)은 보고에 나온 횟수와 그 일의 통상 소요 시간으로 보수적으로 추정하고, savingsBasis에 계산식과 가정을 적습니다(예: "주 4회 × 회당 40분 → AI 초안 후 검토 10분, 주 2시간 절감"). 확실하지 않으면 낮게 잡고 questions에 확인할 점을 적습니다.
- 실행 가능성: 각 개선안은 다음 주부터 시작할 수 있을 만큼 구체적이어야 합니다. 시스템 개발안(approach: system)은 system에 "화면 위치 / 입력 / AI가 하는 일 / 출력 / 저장·알림"을 한 문단으로 씁니다.
  외부 도구안(approach: external)은 어떤 도구를 어떻게 쓰는지 쓰고 toolPrompt에 직원이 그대로 복사해 쓸 수 있는 한국어 프롬프트를 적습니다. 업무 방식 개선(approach: process)은 양식·순서·역할을 어떻게 바꾸는지 씁니다.
  해당 없는 칸은 빈 문자열로 둡니다.
- 사람 이름, 개인 평가, 특정인 비교는 절대 쓰지 마세요. 부서 단위로만 씁니다.
- 한국어로, 컨설팅 보고서 문체(간결한 '~함/~임' 또는 '~합니다')로 씁니다. 같은 말을 반복하지 마세요.

## 출력 항목
- summary: 경영진 요약 2~4문장. 이 부서의 업무 구조, 가장 큰 비효율, 가장 먼저 할 일을 수치와 함께.
- replaceRate: 이 부서 업무 시간 중 AI로 대체·자동화 가능한 비율(%) 추정.
- hoursObserved: 보고로 확인되는 이 부서의 주간 업무 시간 추정 합계(보고에 나온 일만). hoursSavable: 개선안을 모두 적용하면 줄일 수 있는 주간 시간 합계.
- categories: 업무 종류 3~7개. count는 보고에 나온 횟수, share는 시간 비중(%), examples는 실제 일 2개.
- tasks: 업무 목록 5~12개 (같은 일은 합침). times(이번 주 나온 횟수), evidence(원문 인용), tools(쓰는 도구 추정), output(산출물), hoursPerWeek, replaceability(full/partial/human), score(AI 대체 가능도 0~100), reason(판단 이유 한 문장).
- recurring: 이번 주 2번 이상 반복된 일 (없으면 빈 배열).
- issues: 문제점·비효율 2~5개. finding(무엇이 문제인지 구체적으로), evidence(원문 인용), impact(시간·실수·리스크 측면 영향).
- ideas: 개선안 3~6개, 효과가 큰 순서로. task(대상 업무), title(한 줄 제목), level(replace/assist/human), approach(system/external/process), asIs(지금 방식), toBe(바뀐 뒤 방식),
  how(구체 방법), system(시스템 설계, 해당 시), toolPrompt(바로 쓰는 프롬프트, 해당 시), steps(실행 단계 3~5개, 첫 단계는 이번 주에 할 수 있는 것), hoursSaved(주간 절감 시간), savingsBasis(계산 근거),
  errorReduction(줄어드는 실수·누락, 없으면 빈 문자열), effort(만들기 어려움), impact(효과), risks(주의할 점), kpi(성과를 확인할 지표와 목표값).
- humanTasks: 사람이 계속 해야 하는 일 1~3개와 이유.
- ceoPoints: 대표님께 보고·결정 요청할 포인트 2~4개 (리스크, 투자 필요, 인력 재배치 가능성 등).
- questions: 판단에 부족한 정보, 부서에 확인할 질문 0~4개.`;

const plainText = (t: string) => String(t ?? '').replace(/\[\/?(b|red|blue|hl)\]/g, '').trim();
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function workmapAuth(service: Db, body: Record<string, unknown>, authHeader: string): Promise<Response | null> {
  const { data: sec } = await service.from('app_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
  if (sec?.value && body.secret === sec.value) return null;
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: m } = await service.from('members').select('username, is_admin, active').eq('id', auth.user.id).maybeSingle();
  if (!m?.active || !m.is_admin || m.username !== 'admin') return json({ error: '업무 분석은 관리자(admin) 계정만 쓸 수 있습니다.' }, 403);
  return null;
}

async function workmap(service: Db, body: Record<string, unknown>, authHeader: string): Promise<Response> {
  const denied = await workmapAuth(service, body, authHeader);
  if (denied) return denied;
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI용 API 키가 아직 설정되지 않았습니다.' }, 503);
  const client = new Anthropic({ apiKey });

  if (body.mode === 'workmap-collect') return json(await workmapCollect(service, client));

  const weekId = String(body.weekId ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekId) || new Date(`${weekId}T00:00:00Z`).getUTCDay() !== 1) return json({ error: '보고 주(월요일)가 맞지 않습니다.' }, 400);
  const { data: aiRow } = await service.from('app_settings').select('value').eq('key', 'ai_enabled').maybeSingle();
  if ((aiRow?.value as Record<string, boolean> | null)?.master === false) return json({ error: '관리자가 AI 기능을 꺼 두었습니다.' }, 403);

  // 같은 주를 이미 분석 중이면 다시 보내지 않는다
  const { data: run } = await service.from('work_runs').select('status, started_at, batch_id').eq('week_id', weekId).maybeSingle();
  if (run?.status === 'running' && run.batch_id && Date.now() - Date.parse(run.started_at) < 6 * 3600000) return json({ started: false, running: true });

  const from = addDays(weekId, -7);
  const to = addDays(weekId, -1);
  const [{ data: depts }, { data: daily }, { data: entries }, { data: sites }] = await Promise.all([
    service.from('departments').select('id, name').eq('active', true).order('sort'),
    service.from('daily_reports').select('date, department_id, site_id, content').gte('date', from).lte('date', to).neq('content', '').order('date'),
    service.from('entries').select('kind, department_id, site_id, content').eq('week_id', weekId).neq('content', ''),
    service.from('sites').select('id, name'),
  ]);
  const siteName = new Map((sites ?? []).map((s) => [s.id, s.name]));
  const jobs = (depts ?? []).map((d) => {
    const lines = [
      ...(daily ?? []).filter((r) => r.department_id === d.id).map((r) => `[일일보고 ${r.date}${r.site_id ? ` · ${siteName.get(r.site_id) ?? '현장'}` : ''}]\n${plainText(r.content)}`),
      ...(entries ?? []).filter((e) => e.department_id === d.id).map((e) => `[주간보고${e.kind === 'site' && e.site_id ? ` · ${siteName.get(e.site_id) ?? '현장'}` : ' · 부서 업무'}]\n${plainText(e.content)}`),
    ].filter((l) => l.split('\n').slice(1).join('').trim());
    return { d, lines };
  });
  const todo = jobs.filter((j) => j.lines.length);
  const empty = jobs.filter((j) => !j.lines.length).map((j) => j.d.id);
  if (empty.length) await service.from('work_analyses').delete().eq('week_id', weekId).in('department_id', empty);
  if (!todo.length) {
    await service.from('work_runs').upsert({ week_id: weekId, status: 'done', total: 0, done: 0, error: null, batch_id: null, meta: {}, started_at: new Date().toISOString(), finished_at: new Date().toISOString() });
    return json({ started: false, total: 0 });
  }

  const period = `${from} ~ ${addDays(weekId, -2)}`;
  // 예산으로 모델 고르기: Opus로 해도 예산의 90% 안이면 Opus, 아니면 Sonnet(95% 안), 그래도 넘치면 이번 주는 쉰다
  const budget = await budgetState(service);
  const { data: past } = await service.from('ai_usage').select('output_tokens, units').eq('feature', 'workmap').order('at', { ascending: false }).limit(5);
  const outPerDept = past?.length ? past.reduce((n: number, r: { output_tokens: number; units: number }) => n + r.output_tokens / Math.max(1, r.units), 0) / past.length : 15000;
  const inTokens = todo.reduce((n, j) => n + Math.min(150_000, j.lines.join('\n').length) / 1.2 + 3500, 0);
  const est = (m: string) => costUsd(m, inTokens, outPerDept * todo.length * 1.2, true);
  const model = budget.spentUsd + est(WORKMAP_MODEL) <= budget.capUsd * 0.9 ? WORKMAP_MODEL
    : budget.spentUsd + est('claude-sonnet-5-5') <= budget.capUsd * 0.95 ? 'claude-sonnet-5-5' : null;
  if (!model) {
    const msg = `이번 달 AI 예산이 부족해 분석을 쉬었습니다 (사용 ${won(budget.spentUsd, budget.krwPerUsd)} / 예산 ${won(budget.capUsd, budget.krwPerUsd)}, 이 주 분석 예상 ${won(est('claude-sonnet-5-5'), budget.krwPerUsd)} 이상). 다음 달에 다시 분석하거나 예산을 늘려 주세요.`;
    await service.from('work_runs').upsert({ week_id: weekId, status: 'error', total: todo.length, done: 0, error: msg, batch_id: null, meta: {}, started_at: new Date().toISOString(), finished_at: new Date().toISOString() });
    return json({ error: msg }, 402);
  }
  let batch;
  try {
    batch = await client.messages.batches.create({
      requests: todo.map(({ d, lines }) => {
        // 아주 긴 주는 앞쪽부터 (부서 하나에 보고 원문 약 15만 자까지)
        let used = 0;
        const kept = lines.filter((l) => (used += l.length) <= 150_000);
        return {
          custom_id: d.id,
          params: {
            model,
            max_tokens: 32000,
            system: WORKMAP_SYSTEM,
            output_config: { effort: 'high', format: { type: 'json_schema', schema: WORKMAP_SCHEMA } },
            messages: [{
              role: 'user',
              content: `## 분석 대상\n- 부서: ${d.name}\n- 기간: ${period} (한 주)\n- 보고 ${kept.length}건${kept.length < lines.length ? ` (전체 ${lines.length}건 중 앞쪽)` : ''}\n\n## 보고 원문\n${kept.join('\n---\n')}`,
            }],
          },
        };
      }),
    // deno-lint-ignore no-explicit-any
    } as any);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'AI 사용량이 많아 잠시 후 다시 시도해 주세요.' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 요청이 실패했습니다 (${e.status ?? '연결 오류'}).` }, 502);
    throw e;
  }
  await service.from('work_runs').upsert({
    week_id: weekId, status: 'running', total: todo.length, done: 0, error: null, batch_id: batch.id,
    meta: { ...Object.fromEntries(todo.map(({ d, lines }) => [d.id, lines.length])), model, estimateUsd: est(model) }, started_at: new Date().toISOString(), finished_at: null,
  });
  return json({ started: true, total: todo.length, model });
}

/** 진행 중인 배치 결과를 모아 저장한다 */
async function workmapCollect(service: Db, client: Anthropic) {
  const { data: runs } = await service.from('work_runs').select('week_id, batch_id, total, meta').eq('status', 'running').not('batch_id', 'is', null);
  const out: { weekId: string; status: string; done: number }[] = [];
  for (const run of runs ?? []) {
    try {
      const b = await client.messages.batches.retrieve(run.batch_id);
      const c = b.request_counts;
      const finished = c.succeeded + c.errored + c.canceled + c.expired;
      if (b.processing_status !== 'ended') {
        await service.from('work_runs').update({ done: finished }).eq('week_id', run.week_id);
        out.push({ weekId: run.week_id, status: 'running', done: finished });
        continue;
      }
      const errors: string[] = [];
      let saved = 0;
      const use = { input_tokens: 0, output_tokens: 0 };
      let usedModel = '';
      for await (const r of await client.messages.batches.results(run.batch_id)) {
        if (r.result.type !== 'succeeded') { errors.push(r.result.type); continue; }
        const m = r.result.message;
        use.input_tokens += m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0); use.output_tokens += m.usage.output_tokens; usedModel = m.model;
        if (m.stop_reason !== 'end_turn') { errors.push(String(m.stop_reason)); continue; }
        // deno-lint-ignore no-explicit-any
        const text = m.content.filter((x: any) => x.type === 'text').map((x: any) => x.text).join('');
        try {
          const result = JSON.parse(text);
          await service.from('work_analyses').upsert({
            week_id: run.week_id, department_id: r.custom_id, report_count: Number((run.meta as Record<string, number>)?.[r.custom_id] ?? 0),
            result, model: m.model, created_at: new Date().toISOString(),
          });
          saved++;
        } catch { errors.push('parse'); }
      }
      if (usedModel) await recordUsage(service, 'workmap', usedModel, use, true, Math.max(1, saved), run.batch_id);
      await service.from('work_runs').update({
        meta: { ...(run.meta as Record<string, unknown>), usageRecorded: true },
        status: saved ? 'done' : 'error', done: run.total, finished_at: new Date().toISOString(),
        error: errors.length ? `${errors.length}개 부서 실패 (${[...new Set(errors)].join(', ')})` : null,
      }).eq('week_id', run.week_id);
      out.push({ weekId: run.week_id, status: saved ? 'done' : 'error', done: run.total });
    } catch (e) {
      out.push({ weekId: run.week_id, status: 'check-failed', done: 0 });
      console.error('workmap collect', run.week_id, e instanceof Error ? e.message : e);
    }
  }
  // 예산 기록이 생기기 전에 끝난 분석의 사용량을 채운다
  const { data: old } = await service.from('work_runs').select('week_id, batch_id, meta').neq('status', 'running').not('batch_id', 'is', null).limit(10);
  for (const run of (old ?? []).filter((r: { meta: Record<string, unknown> }) => !r.meta?.usageRecorded).slice(0, 3)) {
    try {
      const use = { input_tokens: 0, output_tokens: 0 };
      let usedModel = '';
      let n = 0;
      for await (const r of await client.messages.batches.results(run.batch_id)) {
        if (r.result.type !== 'succeeded') continue;
        const m = r.result.message;
        use.input_tokens += m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0); use.output_tokens += m.usage.output_tokens; usedModel = m.model; n++;
      }
      if (usedModel) await recordUsage(service, 'workmap', usedModel, use, true, Math.max(1, n), run.batch_id);
      await service.from('work_runs').update({ meta: { ...(run.meta ?? {}), usageRecorded: true } }).eq('week_id', run.week_id);
    } catch (e) { console.error('workmap usage backfill', e instanceof Error ? e.message : e); }
  }
  return { runs: out };
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));
  // 업무 분석: 예약 작업(비밀값) 또는 찐관리자(admin 계정)
  if (body.mode === 'workmap' || body.mode === 'workmap-collect') return workmap(service, body, req.headers.get('Authorization') ?? '');
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: actor } = await service.from('members').select('is_ceo, is_admin, active').eq('id', auth.user.id).single();
  // 현장 기간 요약은 대표·관리자, 주간 요약은 대표만
  const siteMode = body.mode === 'site';
  const askMode = body.mode === 'ask';
  const safetyMode = body.mode === 'safety';
  const ocrMode = body.mode === 'ocr';
  if (!actor?.active || !(actor.is_ceo || (siteMode && actor.is_admin) || ocrMode)) {
    return json({ error: siteMode ? '현장 기간 요약은 대표님과 관리자만 만들 수 있습니다.' : askMode ? 'AI 질문은 대표님만 쓸 수 있습니다.' : safetyMode ? '안전 당부 초안은 대표님만 만들 수 있습니다.' : 'AI 요약은 대표님만 만들 수 있습니다.' }, 403);
  }
  const { weekId, sourceUpdatedAt, siteId, months } = body;
  const prompt: string = typeof body.prompt === 'string' ? body.prompt : '';
  if (!ocrMode && (!prompt.trim() || (!askMode && !safetyMode && (siteMode ? typeof siteId !== 'string' : typeof weekId !== 'string')))) return json({ error: '요청 형식이 맞지 않습니다.' }, 400);
  if (prompt.length > 400_000) return json({ error: '보낼 보고가 너무 많습니다. 기간을 줄여 주세요.' }, 413);

  // 글자 없는 자료 읽기: 올린 사람·대표·관리자만, 20MB 이하
  let ocrDoc: { id: string; storage_path: string; file_type: string; file_name: string } | null = null;
  let ocrContent: unknown[] = [];
  if (ocrMode) {
    const { data: d } = await service.from('site_docs').select('id, storage_path, file_type, file_name, uploaded_by, text').eq('id', String(body.docId ?? '')).maybeSingle();
    if (!d) return json({ error: '자료를 찾을 수 없습니다.' }, 404);
    if (d.uploaded_by !== auth.user.id && !actor!.is_ceo && !actor!.is_admin) return json({ error: '올린 사람만 요청할 수 있습니다.' }, 403);
    if (String(d.text ?? '').trim()) return json({ ok: true, skipped: 'has text' });
    if (d.file_type !== 'pdf' && d.file_type !== 'image') return json({ ok: true, skipped: 'not readable' });
    const { data: file } = await service.storage.from('talk-files').download(d.storage_path);
    if (!file) return json({ error: '파일을 찾을 수 없습니다.' }, 404);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) return json({ ok: true, skipped: 'too large' });
    const data = toBase64(bytes);
    ocrDoc = d;
    ocrContent = [
      d.file_type === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data } },
      { type: 'text', text: '건설 현장 문서(회의록·공사일보·공정표 등)입니다. 보이는 글자를 빠짐없이 그대로 옮겨 적어 주세요. 표는 한 줄에 한 행씩, 칸은 " | "로 나눠 주세요. 설명·요약·머리말은 붙이지 마세요.' },
    ];
  }

  // 관리자가 AI 기능을 꺼 두었으면 요청하지 않는다 (비용 없음)
  const { data: aiRow } = await service.from('app_settings').select('value').eq('key', 'ai_enabled').maybeSingle();
  const ai = { master: true, ask: true, ...((aiRow?.value as Record<string, boolean> | null) ?? {}) };
  if (!ai.master || (askMode && !ai.ask)) return json({ error: '관리자가 AI 기능을 꺼 두었습니다.' }, 403);

  // 관리자 페이지 > 설정에서 고른 모델 (기본 Haiku 5.5)
  const { data: setting } = await service.from('app_settings').select('value').eq('key', 'summary_model').maybeSingle();
  const model = MODELS.includes(setting?.value) ? (setting!.value as string) : MODELS[0];

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI 요약용 API 키가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.' }, 503);
  const client = new Anthropic({ apiKey });
  // deno-lint-ignore no-explicit-any
  const request: any = ocrMode ? {
    model,
    max_tokens: 16000,
    messages: [{ role: 'user', content: ocrContent }],
  } : {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' as const, format: { type: 'json_schema' as const, schema: askMode ? ASK_SCHEMA : safetyMode ? SAFETY_SCHEMA : siteMode ? SITE_SCHEMA : SCHEMA } },
    messages: [{ role: 'user' as const, content: prompt }],
  };
  // 한 달 AI 예산을 다 썼으면 요청하지 않는다
  const budget = await budgetState(service);
  if (budget.spentUsd >= budget.capUsd) return json({ error: `이번 달 AI 예산(${won(budget.capUsd, budget.krwPerUsd)})을 모두 썼습니다. 다음 달 1일에 다시 쓸 수 있습니다.` }, 402);
  let response;
  try {
    // Haiku 5.5는 서버 쪽 거절 대체 모델이 없어 일반 요청으로 보낸다
    response = model === 'claude-haiku-5-5'
      ? await client.messages.create(request)
      : await client.beta.messages.create({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'AI 사용량이 많아 잠시 후 다시 시도해 주세요.' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI 요청이 실패했습니다 (${e.status ?? '연결 오류'}).` }, 502);
    throw e;
  }

  await recordUsage(service, ocrMode ? 'ocr' : askMode ? 'ask' : safetyMode ? 'safety' : siteMode ? 'site' : 'summary', response.model, response.usage).catch(() => undefined);
  if (response.stop_reason === 'refusal') return json({ error: askMode ? 'AI가 이 질문에 답하지 않았습니다. 질문을 바꿔 보세요.' : 'AI가 이 보고의 요약을 거절했습니다. 원문을 확인해 주세요.' }, 422);
  if (response.stop_reason === 'max_tokens') return json({ error: askMode ? '답이 너무 길어 끊겼습니다. 질문을 좁혀 주세요.' : '보고가 너무 길어 요약이 끊겼습니다.' }, 422);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  if (ocrMode && ocrDoc) {
    const { error } = await service.from('site_docs').update({ text: text.trim().slice(0, 60000) }).eq('id', ocrDoc.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, chars: text.length });
  }

  if (safetyMode) {
    try {
      const a = JSON.parse(text) as { tips: { siteId: string; text: string }[] };
      return json({ tips: a.tips, model: response.model });
    } catch {
      return json({ error: '초안을 읽지 못했습니다.' }, 502);
    }
  }

  if (askMode) {
    try {
      const a = JSON.parse(text) as { answer: string; sourceIds: string[] };
      return json({ answer: a.answer, sourceIds: a.sourceIds, model: response.model });
    } catch {
      return json({ error: '답을 읽지 못했습니다. 다시 물어봐 주세요.' }, 502);
    }
  }

  if (siteMode) {
    let site: { overview: string; milestones: { weekId: string; text: string }[]; issues: string[] };
    try {
      site = JSON.parse(text);
    } catch {
      return json({ error: '요약 결과를 읽지 못했습니다. 다시 만들어 주세요.' }, 502);
    }
    const { data: row, error } = await service.from('site_summaries').upsert({
      site_id: siteId,
      months: Number(months) || 3,
      overview: site.overview,
      milestones: site.milestones.slice(0, 8),
      issues: site.issues.slice(0, 5),
      model: response.model,
      generated_at: new Date().toISOString(),
      generated_by: auth.user.id,
    }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json({ summary: row });
  }

  let parsed: { highlights: string[]; siteChanges: { siteId: string; change: string }[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: '요약 결과를 읽지 못했습니다. 다시 만들어 주세요.' }, 502);
  }

  const { data: row, error } = await service.from('ai_summaries').upsert({
    week_id: weekId,
    highlights: parsed.highlights.slice(0, 5),
    site_changes: parsed.siteChanges,
    generated_at: new Date().toISOString(),
    generated_by: auth.user.id,
    model: response.model,
    source_updated_at: sourceUpdatedAt ?? null,
  }).select().single();
  if (error) return json({ error: error.message }, 500);
  return json({ summary: row });
});
