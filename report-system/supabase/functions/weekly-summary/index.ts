// 대표 전용: 이번 주 보고를 Claude로 요약해 저장한다 (모델은 app_settings.summary_model)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: actor } = await service.from('members').select('is_ceo, active').eq('id', auth.user.id).single();
  if (!actor?.is_ceo || !actor.active) return json({ error: 'AI 요약은 대표님만 만들 수 있습니다.' }, 403);

  const { weekId, prompt, sourceUpdatedAt } = await req.json();
  if (typeof prompt !== 'string' || !prompt.trim() || typeof weekId !== 'string') return json({ error: '요청 형식이 맞지 않습니다.' }, 400);

  // 관리자 페이지 > 설정에서 고른 모델 (기본 Haiku 5.5)
  const { data: setting } = await service.from('app_settings').select('value').eq('key', 'summary_model').maybeSingle();
  const model = MODELS.includes(setting?.value) ? (setting!.value as string) : MODELS[0];

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'AI 요약용 API 키가 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.' }, 503);
  const client = new Anthropic({ apiKey });
  const request = {
    model,
    max_tokens: 16000,
    output_config: { effort: 'medium' as const, format: { type: 'json_schema' as const, schema: SCHEMA } },
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

  if (response.stop_reason === 'refusal') return json({ error: 'AI가 이 보고의 요약을 거절했습니다. 원문을 확인해 주세요.' }, 422);
  if (response.stop_reason === 'max_tokens') return json({ error: '보고가 너무 길어 요약이 끊겼습니다.' }, 422);
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
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
