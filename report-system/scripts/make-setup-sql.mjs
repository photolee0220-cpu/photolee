// 새 Supabase 프로젝트에 한 번에 붙여넣을 설정 SQL을 만든다.
// 스키마(migrations) + 초기 데이터(seed.json) + 로그인 계정(임시 비밀번호)
// 사용법: node scripts/make-setup-sql.mjs [seed.json] [출력 폴더]
// 결과에는 회사 데이터와 비밀번호가 들어가므로 저장소에 올리지 않는다.
import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , seedPath = 'seed/private/seed.json', outDir = 'seed/private/setup'] = process.argv;
const domain = process.env.LOGIN_EMAIL_DOMAIN || 'sadakdari-report.app';
const seed = JSON.parse(readFileSync(seedPath, 'utf8'));

const q = (v) => (v == null ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(q).join(',')}]::text[]`;
const ids = new Map();
const uid = (k) => { if (!k) return null; if (!ids.has(k)) ids.set(k, randomUUID()); return ids.get(k); };
const pw = () => `sadak${randomInt(1000, 10000)}`;

const out = [];
const push = (s) => out.push(s);

push('-- 사닥다리 주간보고: 새 Supabase 프로젝트 초기 설정 (SQL Editor에 통째로 붙여넣고 Run)');
push('-- 한 번만 실행하세요. 중간에 오류가 나면 아무것도 바뀌지 않습니다.');
push('begin;');
for (const f of readdirSync('supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
  push(`\n-- ===== ${f} =====`);
  push(readFileSync(join('supabase/migrations', f), 'utf8'));
}

push('\n-- ===== 초기 데이터 =====');
for (const d of seed.departments) {
  push(`insert into public.departments (id, name, sort, writes_sites, active) values (${q(uid(d.id))}, ${q(d.name)}, ${d.sort}, ${d.writesSites}, ${d.active});`);
}

const accounts = [];
for (const m of seed.members) {
  const id = uid(m.id);
  const email = `${m.username}@${domain}`;
  const password = pw();
  accounts.push({ name: m.name, title: m.title, dept: seed.departments.find((d) => d.id === m.departmentId)?.name ?? (m.isCeo ? '대표' : '관리자'), username: m.username, password, role: m.isCeo ? '대표' : m.isAdmin ? '관리자' : '직원' });
  push(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', ${q(id)}, 'authenticated', 'authenticated', ${q(email)}, extensions.crypt(${q(password)}, extensions.gen_salt('bf')), now(), null, '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');`);
  push(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), ${q(id)}, ${q(id)}, jsonb_build_object('sub', ${q(id)}, 'email', ${q(email)}, 'email_verified', true), 'email', null, now(), now());`);
  push(`insert into public.members (id, username, name, title, department_id, is_ceo, is_admin, active, must_change_password) values (${q(id)}, ${q(m.username)}, ${q(m.name)}, ${q(m.title)}, ${q(uid(m.departmentId))}, ${m.isCeo}, ${m.isAdmin}, true, true);`);
}

for (const g of seed.grants) {
  push(`insert into public.dept_view_grants (viewer_department_id, target_department_id) values (${q(uid(g.viewerDepartmentId))}, ${q(uid(g.targetDepartmentId))});`);
}

for (const s of seed.sites) {
  push(`insert into public.sites (id, name, note, stage, due_date, due_text, process, progress, scale, tags, sort, archived, completed_at) values (${q(uid(s.id))}, ${q(s.name)}, ${q(s.note)}, ${q(s.stage)}, ${q(s.dueDate)}, ${q(s.dueText)}, ${q(s.process)}, ${s.progress ?? 'null'}, ${q(s.scale)}, ${arr(s.tags)}, ${s.sort}, ${s.archived}, ${q(s.completedAt)});`);
}

const weeks = [...new Set([...seed.entries.map((e) => e.weekId), ...seed.directives.map((d) => d.weekId)])].sort();
for (const w of weeks) push(`insert into public.weeks (id) values (${q(w)});`);

for (const e of seed.entries) {
  push(`insert into public.entries (week_id, kind, site_id, department_id, author_id, content, updated_at, updated_by) values (${q(e.weekId)}, ${q(e.kind)}, ${q(uid(e.siteId))}, ${q(uid(e.departmentId))}, ${q(uid(e.authorId))}, ${q(e.content)}, ${q(e.updatedAt)}, ${q(uid(e.updatedBy))});`);
}
for (const d of seed.directives) {
  push(`insert into public.directives (week_id, target_kind, site_id, member_id, slot, content, updated_at) values (${q(d.weekId)}, ${q(d.targetKind)}, ${q(uid(d.siteId))}, ${q(uid(d.memberId))}, ${q(d.slot)}, ${q(d.content)}, ${q(d.updatedAt)});`);
}
push('\ncommit;');
push(`select '설정 완료: 부서 ${seed.departments.length}, 계정 ${seed.members.length}, 현장 ${seed.sites.length}, 보고 ${seed.entries.length}' as 결과;`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'setup.sql'), out.join('\n'));
const lines = ['구분,이름,직급,부서,아이디,임시 비밀번호'];
for (const a of accounts) lines.push([a.role, a.name, a.title, a.dept, a.username, a.password].join(','));
writeFileSync(join(outDir, 'accounts.csv'), '﻿' + lines.join('\n'));
console.log(`${join(outDir, 'setup.sql')} (${(out.join('\n').length / 1024).toFixed(0)} KB), 계정 ${accounts.length}개 → ${join(outDir, 'accounts.csv')}`);
