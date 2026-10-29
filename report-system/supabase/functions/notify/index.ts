// 푸시 알림: 마감 전 미작성자 알림, 대표 피드백 알림, 시험 알림
// 호출: 화면(로그인한 직원) → public-key, test / 서버 예약 작업(pg_cron·트리거) → deadline, feedback (cron_secret 확인)
// 알림 서명 키(VAPID)는 처음 필요할 때 만들어 app_secrets에 보관한다
import webpush from 'npm:web-push@3.6.7';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUBJECT = 'mailto:admin@sadakdari-report.app';

interface Payload { title: string; body: string; url?: string; tag?: string }
interface Sub { id: string; endpoint: string; p256dh: string; auth: string }

async function secret(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function vapid(db: SupabaseClient): Promise<{ publicKey: string; privateKey: string }> {
  let publicKey = await secret(db, 'vapid_public');
  let privateKey = await secret(db, 'vapid_private');
  if (!publicKey || !privateKey) {
    const k = webpush.generateVAPIDKeys();
    // 동시에 두 번 만들어도 먼저 저장된 키를 쓴다
    await db.from('app_secrets').upsert([{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }], { onConflict: 'key', ignoreDuplicates: true });
    publicKey = await secret(db, 'vapid_public');
    privateKey = await secret(db, 'vapid_private');
  }
  return { publicKey: publicKey!, privateKey: privateKey! };
}

/** 이번 보고일 (한국 시간): 월요일이면 오늘, 아니면 다가오는 월요일 */
function currentWeek(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  kst.setUTCDate(kst.getUTCDate() + ((8 - day) % 7));
  return kst.toISOString().slice(0, 10);
}

async function send(db: SupabaseClient, memberIds: string[], payload: Payload, kind: string) {
  if (!memberIds.length) return { sent: 0, failed: 0 };
  const keys = await vapid(db);
  const siteUrl = (await secret(db, 'site_url')) ?? '';
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('member_id', memberIds);
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  const body = JSON.stringify({ ...payload, url: payload.url ?? siteUrl });
  await Promise.all(((subs ?? []) as Sub[]).map(async (s) => {
    try {
      const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
        vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey }, TTL: 6 * 3600,
      });
      const res = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>, body: req.body as Uint8Array });
      if (res.ok) sent++;
      else {
        failed++;
        if (res.status === 404 || res.status === 410) gone.push(s.id);
      }
    } catch {
      failed++;
    }
  }));
  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone);
  await db.from('push_log').insert({ kind, sent, failed, detail: `${memberIds.length}명 대상, 기기 ${(subs ?? []).length}대${gone.length ? `, 만료 ${gone.length}대 정리` : ''}` });
  return { sent, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const input = await req.json().catch(() => ({}));
  const action = String(input.action ?? '');

  // 서버 예약 작업에서 오는 요청
  if (action === 'deadline' || action === 'feedback') {
    const expected = await secret(db, 'cron_secret');
    if (!expected || input.secret !== expected) return json({ error: 'forbidden' }, 403);

    if (action === 'deadline') {
      const week = currentWeek();
      const { data: members } = await db.from('members').select('id, name').eq('active', true).eq('is_ceo', false).not('department_id', 'is', null);
      const { data: written } = await db.from('entries').select('updated_by').eq('week_id', week).neq('content', '');
      const done = new Set((written ?? []).map((r) => r.updated_by));
      const targets = (members ?? []).filter((m) => !done.has(m.id)).map((m) => m.id);
      const r = await send(db, targets, { title: '주간보고 작성 알림', body: '이번 주 보고가 아직 없습니다. 마감은 토요일 오전 10시입니다.', tag: `deadline-${week}` }, 'deadline');
      return json({ week, targets: targets.length, ...r });
    }

    const { data: c } = await db.from('comments').select('id, entry_id, content').eq('id', input.commentId).maybeSingle();
    if (!c) return json({ error: 'not found' }, 404);
    const { data: e } = await db.from('entries').select('kind, site_id, department_id, author_id').eq('id', c.entry_id).maybeSingle();
    if (!e) return json({ error: 'not found' }, 404);
    let targets: string[] = [];
    let where = '부서 업무보고';
    if (e.kind === 'site') {
      const [{ data: people }, { data: site }] = await Promise.all([
        db.from('members').select('id').eq('active', true).eq('department_id', e.department_id),
        db.from('sites').select('name').eq('id', e.site_id).maybeSingle(),
      ]);
      targets = (people ?? []).map((m) => m.id);
      where = site?.name ?? '현장 보고';
    } else if (e.author_id) {
      targets = [e.author_id];
    }
    const text = String(c.content).replace(/\s+/g, ' ').slice(0, 90);
    const r = await send(db, targets, { title: `대표님 피드백 · ${where}`, body: text, tag: `feedback-${c.id}` }, 'feedback');
    return json(r);
  }

  // 화면에서 오는 요청: 로그인한 직원만
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: me } = await db.from('members').select('id, active').eq('id', auth.user.id).maybeSingle();
  if (!me?.active) return json({ error: '사용할 수 없는 계정입니다.' }, 403);

  if (action === 'public-key') return json({ publicKey: (await vapid(db)).publicKey });
  if (action === 'test') return json(await send(db, [me.id], { title: '주간보고 알림 시험', body: '이 기기에서 알림을 받을 수 있습니다 ✓', tag: 'test' }, 'test'));
  return json({ error: '알 수 없는 요청입니다.' }, 400);
});
