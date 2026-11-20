// 푸시 알림: 마감 전 미작성자 알림(주간·일일), 피드백 알림(주간·일일), 채팅·공지·문의 알림, 시험 알림
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

/** 오늘 날짜 (한국 시간) */
function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 알림 쉬는 시간인지 (한국 시간, 관리자 설정). 예: 22:00~07:00 */
function inQuiet(q: { enabled?: boolean; from?: string; to?: string } | undefined, now = new Date()): boolean {
  if (!q?.enabled || !q.from || !q.to) return false;
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const cur = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const a = mins(q.from); const b = mins(q.to);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** 알림 본문용: 강조 표시를 빼고 한 줄로 */
const plain = (t: string) => String(t).replace(/\[\/?(b|red|blue|hl)\]/g, '').replace(/\s+/g, ' ').slice(0, 90);

/** 부서 안 보고 부서원(부서장 제외): 주간보고 대상이 아니다 */
async function internalMemberIds(db: SupabaseClient): Promise<Set<string>> {
  const { data: depts } = await db.from('departments').select('id, head_id').eq('internal_report', true);
  if (!depts?.length) return new Set();
  const { data: ms } = await db.from('members').select('id, department_id').in('department_id', depts.map((d) => d.id));
  const heads = new Set(depts.map((d) => d.head_id));
  return new Set((ms ?? []).filter((m) => !heads.has(m.id)).map((m) => m.id));
}

async function send(db: SupabaseClient, memberIds: string[], payload: Payload, kind: string) {
  if (!memberIds.length) return { sent: 0, failed: 0 };
  const keys = await vapid(db);
  const siteUrl = (await secret(db, 'site_url')) ?? '';
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('member_id', memberIds);
  let sent = 0;
  let failed = 0;
  const gone: string[] = [];
  // '?open=…' 처럼 물음표로 시작하면 사이트 주소 뒤에 붙여 그 화면으로 바로 가게 한다
  const body = JSON.stringify({ ...payload, url: payload.url?.startsWith('?') ? `${siteUrl.replace(/\/?$/, '/')}${payload.url}` : payload.url ?? siteUrl });
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
  if (['deadline', 'feedback', 'daily-deadline', 'daily-feedback', 'chat', 'notice', 'notice-remind', 'inquiry-stale'].includes(action)) {
    const expected = await secret(db, 'cron_secret');
    if (!expected || input.secret !== expected) return json({ error: 'forbidden' }, 403);

    if (action === 'deadline') {
      const week = currentWeek();
      const internal = await internalMemberIds(db);
      const { data: all } = await db.from('members').select('id, name, affiliation').eq('active', true).eq('is_ceo', false).eq('is_executive', false).eq('weekly_enabled', true).not('department_id', 'is', null);
      // 현장 직원과 부서원은 일일보고만 쓰므로 주간보고 알림에서 뺀다
      const members = (all ?? []).filter((m) => !internal.has(m.id) && m.affiliation !== 'site');
      // 쓴 사람: 부서 업무보고는 본인 칸, 현장 칸은 함께 쓴 사람 모두
      const { data: written } = await db.from('entries').select('kind, author_id, updated_by, writers').eq('week_id', week).neq('content', '');
      const done = new Set((written ?? []).flatMap((r) => (r.kind === 'dept' ? [r.author_id] : [r.updated_by, ...(r.writers ?? [])])));
      const targets = members.filter((m) => !done.has(m.id)).map((m) => m.id);
      const r = await send(db, targets, { title: '[주간보고] 작성 알림', body: '이번 주 보고가 아직 없습니다. 마감은 토요일 오전 10시입니다.', tag: `deadline-${week}` }, 'deadline');
      return json({ week, targets: targets.length, ...r });
    }

    // 평일 오후 6시: 그날 일일보고를 안 쓴 사람 (근무 상태 등록자는 반차 빼고 제외)
    if (action === 'daily-deadline') {
      const date = todayKst();
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0 || dow === 6) return json({ date, skipped: 'weekend' });
      const [{ data: people }, { data: rep }, { data: ph }, { data: st }] = await Promise.all([
        db.from('members').select('id').eq('active', true).eq('is_ceo', false).eq('is_executive', false).eq('daily_enabled', true).not('department_id', 'is', null),
        db.from('daily_reports').select('author_id').eq('date', date).neq('content', ''),
        db.from('daily_photos').select('author_id').eq('date', date),
        db.from('day_status').select('member_id, kind').lte('start_date', date).gte('end_date', date),
      ]);
      const done = new Set([...(rep ?? []).map((r) => r.author_id), ...(ph ?? []).map((r) => r.author_id)]);
      const away = new Set((st ?? []).filter((x) => x.kind !== 'half').map((x) => x.member_id));
      const targets = (people ?? []).map((m) => m.id).filter((id) => !done.has(id) && !away.has(id));
      const r = await send(db, targets, { title: '[일일보고] 작성 알림', body: '오늘 일일보고를 아직 쓰지 않으셨습니다. 오늘 안에 써 주세요.', tag: `daily-${date}` }, 'daily-deadline');
      return json({ date, targets: targets.length, ...r });
    }

    // 채팅: 방 인원에게 (알림 끈 방·쉬는 시간은 빼되 @부르기와 안전 당부는 보낸다)
    if (action === 'chat') {
      const { data: m } = await db.from('chat_messages').select('id, room_id, author_id, text, attachments, mentions, safety, system').eq('id', input.messageId).maybeSingle();
      if (!m) return json({ error: 'not found' }, 404);
      const [{ data: room }, { data: mem }, { data: author }, { data: cfg }] = await Promise.all([
        db.from('chat_rooms').select('kind, name').eq('id', m.room_id).maybeSingle(),
        db.from('chat_room_members').select('member_id, muted').eq('room_id', m.room_id),
        db.from('members').select('name, title, is_ceo').eq('id', m.author_id).maybeSingle(),
        db.from('app_settings').select('value').eq('key', 'talk').maybeSingle(),
      ]);
      const mentions = new Set<string>(m.mentions ?? []);
      const urgent = (id: string) => m.safety || mentions.has(id);
      const quiet = inQuiet(cfg?.value?.quiet);
      const targets = (mem ?? []).filter((x) => x.member_id !== m.author_id)
        .filter((x) => urgent(x.member_id) || (!x.muted && !quiet && !m.system))
        .map((x) => x.member_id);
      const who = author?.is_ceo ? '대표님' : `${author?.name ?? ''} ${author?.title ?? ''}`.trim();
      const att = (m.attachments ?? []) as { kind: string }[];
      const body = plain(m.text) || (att.length ? (att[0].kind === 'image' ? '사진을 보냈습니다' : '파일을 보냈습니다') : '');
      const title = m.safety ? `[안전 당부] ${room?.name ?? ''}` : room?.kind === 'dm' ? who : `[${room?.name ?? '채팅'}] ${who}`;
      const r = await send(db, targets, { title, body, tag: `chat-${m.room_id}`, url: `?open=talk&room=${m.room_id}` }, 'chat');
      return json({ targets: targets.length, ...r });
    }

    // 전체 공지: 모든 직원 / 다시 알림: 아직 안 읽거나 확인 안 한 사람
    if (action === 'notice' || action === 'notice-remind') {
      const { data: n } = await db.from('notices').select('id, title, body, author_id, require_ack').eq('id', input.noticeId).maybeSingle();
      if (!n) return json({ error: 'not found' }, 404);
      const [{ data: people }, { data: reads }] = await Promise.all([
        db.from('members').select('id').eq('active', true),
        db.from('notice_reads').select('member_id, read_at, ack_at').eq('notice_id', n.id),
      ]);
      const done = new Set((reads ?? []).filter((r) => (n.require_ack ? r.ack_at : r.read_at)).map((r) => r.member_id));
      const targets = (people ?? []).map((p) => p.id).filter((id) => id !== n.author_id && (action === 'notice' || !done.has(id)));
      const title = `${action === 'notice-remind' ? '[공지 확인 요청] ' : '[공지] '}${plain(n.title)}`;
      const r = await send(db, targets, { title, body: n.require_ack ? `확인이 필요한 공지입니다. ${plain(n.body)}` : plain(n.body), tag: `notice-${n.id}`, url: '?open=notice' }, action);
      return json({ targets: targets.length, ...r });
    }

    // 매일 아침: 7일 넘게 진행 없는 문의를 담당자(없으면 문의방 인원)에게 (같은 문의는 7일에 한 번)
    if (action === 'inquiry-stale') {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: qs } = await db.from('inquiries').select('id, church, owner_id, last_activity_at, stale_notified_at')
        .in('stage', ['new', 'consult', 'visit', 'proposal']).lt('last_activity_at', cutoff);
      const due = (qs ?? []).filter((q) => !q.stale_notified_at || q.stale_notified_at < cutoff);
      if (!due.length) return json({ stale: 0 });
      const { data: room } = await db.from('chat_rooms').select('id').eq('kind', 'inquiry').maybeSingle();
      const { data: mem } = room ? await db.from('chat_room_members').select('member_id').eq('room_id', room.id) : { data: [] as { member_id: string }[] };
      let sent = 0;
      for (const q of due) {
        const days = Math.floor((Date.now() - Date.parse(q.last_activity_at)) / 86400000);
        const targets = q.owner_id ? [q.owner_id] : (mem ?? []).map((x) => x.member_id);
        const r = await send(db, targets, { title: '[문의] 진행이 멈춘 문의', body: `${q.church} · ${days}일째 진행이 없습니다. 상담 내용을 남기거나 단계를 바꿔 주세요.`, tag: `inquiry-${q.id}`, url: room ? `?open=talk&room=${room.id}` : undefined }, 'inquiry-stale');
        sent += r.sent;
        await db.from('inquiries').update({ stale_notified_at: new Date().toISOString() }).eq('id', q.id);
      }
      return json({ stale: due.length, sent });
    }

    if (action === 'daily-feedback') {
      const { data: c } = await db.from('daily_comments').select('id, date, member_id, author_id, content').eq('id', input.commentId).maybeSingle();
      if (!c) return json({ error: 'not found' }, 404);
      const { data: author } = await db.from('members').select('name, title, is_ceo').eq('id', c.author_id).maybeSingle();
      const who = author?.is_ceo ? '대표님' : `${author?.name ?? ''} ${author?.title ?? ''}`.trim();
      const [, m, d] = String(c.date).split('-');
      const r = await send(db, [c.member_id], { title: `[일일보고] ${who} 피드백 · ${Number(m)}/${Number(d)}`, body: plain(c.content), tag: `daily-feedback-${c.id}` }, 'daily-feedback');
      return json(r);
    }

    const { data: c } = await db.from('comments').select('id, entry_id, content, author_id').eq('id', input.commentId).maybeSingle();
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
    const text = plain(c.content);
    const { data: author } = await db.from('members').select('name, title, is_ceo').eq('id', c.author_id).maybeSingle();
    const who = author?.is_ceo ? '대표님 피드백' : `${author?.name ?? ''} ${author?.title ?? ''} 코멘트`.trim();
    const r = await send(db, targets, { title: `[주간보고] ${who} · ${where}`, body: text, tag: `feedback-${c.id}` }, 'feedback');
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
  if (action === 'test') return json(await send(db, [me.id], { title: '업무보고 알림 시험', body: '이 기기에서 알림을 받을 수 있습니다 ✓', tag: 'test' }, 'test'));
  return json({ error: '알 수 없는 요청입니다.' }, 400);
});
