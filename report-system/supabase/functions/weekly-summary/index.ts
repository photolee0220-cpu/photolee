// 대표 전용: 이번 주 보고를 Claude로 요약해 저장한다 (모델은 app_settings.summary_model)
// mode: 'site' 이면 현장 하나의 여러 달 기록을 요약한다 (대표·관리자)
// mode: 'ask' 이면 대표님 질문에 보고 원문(화면에서 골라 보낸 것)만 근거로 답한다 (저장하지 않음)
// mode: 'safety' 이면 현장 보고에서 찾은 위험 작업으로 대표님 안전 당부 초안을 쓴다 (대표)
// mode: 'ocr' 이면 글자가 없는 현장 자료(스캔 PDF·사진)를 읽어 글자를 저장한다 (올린 사람·대표·관리자)
// 배포: supabase functions deploy weekly-summary
// 비밀값: supabase secrets set ANTHROPIC_API_KEY=...
import Anthropic from 'npm:@anthropic-ai/sdk@0.133.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];

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

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: actor } = await service.from('members').select('is_ceo, is_admin, active').eq('id', auth.user.id).single();
  const body = await req.json();
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
