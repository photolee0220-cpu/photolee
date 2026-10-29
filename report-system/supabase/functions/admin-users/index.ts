// 관리자 전용: 직원 계정 생성, 아이디 변경, 비밀번호 초기화, 사용 중지
// 배포: supabase functions deploy admin-users
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  const { data: auth } = await caller.auth.getUser();
  if (!auth.user) return json({ error: '로그인이 필요합니다.' }, 401);
  const { data: actor } = await service.from('members').select('is_admin, active').eq('id', auth.user.id).single();
  if (!actor?.is_admin || !actor.active) return json({ error: '관리자만 할 수 있습니다.' }, 403);

  const body = await req.json();
  const domain = Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'sadakdari-report.app';

  if (body.action === 'create') {
    const { username, password, name, title, departmentId, isAdmin, isCeo, isExecutive } = body;
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: '아이디는 영문 소문자, 숫자, 점(.)으로 3~30자여야 합니다.' }, 400);
    if (!password || password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
    const { data: created, error } = await service.auth.admin.createUser({
      email: `${username}@${domain}`, password, email_confirm: true,
    });
    if (error) return json({ error: error.message.includes('already') ? '이미 사용 중인 아이디입니다.' : error.message }, 400);
    const { data: member, error: e2 } = await service.from('members').insert({
      id: created.user.id, username, name, title: title ?? '', department_id: departmentId,
      is_admin: !!isAdmin, is_ceo: !!isCeo, is_executive: !!isExecutive, must_change_password: true,
    }).select().single();
    if (e2) {
      await service.auth.admin.deleteUser(created.user.id);
      return json({ error: e2.message }, 400);
    }
    return json({ member });
  }

  if (body.action === 'set_username') {
    const username = String(body.username ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: '아이디는 영문 소문자, 숫자, 점(.)으로 3~30자여야 합니다.' }, 400);
    const { data: taken } = await service.from('members').select('id').eq('username', username).neq('id', body.memberId).maybeSingle();
    if (taken) return json({ error: '이미 사용 중인 아이디입니다.' }, 400);
    const { data: before } = await service.from('members').select('username').eq('id', body.memberId).single();
    if (!before) return json({ error: '인원을 찾을 수 없습니다.' }, 404);
    const { error } = await service.auth.admin.updateUserById(body.memberId, { email: `${username}@${domain}`, email_confirm: true });
    if (error) return json({ error: error.message.includes('already') ? '이미 사용 중인 아이디입니다.' : error.message }, 400);
    const { data: member, error: e2 } = await service.from('members').update({ username }).eq('id', body.memberId).select().single();
    if (e2) {
      // 로그인 정보와 인원 정보가 어긋나지 않도록 되돌린다
      await service.auth.admin.updateUserById(body.memberId, { email: `${before.username}@${domain}`, email_confirm: true });
      return json({ error: e2.message }, 400);
    }
    return json({ member });
  }

  if (body.action === 'reset_password') {
    if (!body.password || body.password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400);
    const { error } = await service.auth.admin.updateUserById(body.memberId, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    await service.from('members').update({ must_change_password: true }).eq('id', body.memberId);
    return json({ ok: true });
  }

  if (body.action === 'set_active') {
    if (body.memberId === auth.user.id) return json({ error: '본인 계정은 중지할 수 없습니다.' }, 400);
    await service.auth.admin.updateUserById(body.memberId, { ban_duration: body.active ? 'none' : '876000h' });
    await service.from('members').update({ active: !!body.active }).eq('id', body.memberId);
    return json({ ok: true });
  }

  return json({ error: '알 수 없는 요청입니다.' }, 400);
});
