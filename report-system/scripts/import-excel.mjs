// 기존 주간보고 엑셀(현장×부서 양식)을 초기 데이터(JSON)로 변환합니다.
// 사용법: node scripts/import-excel.mjs <엑셀 경로...> [--out=출력 경로]
// 여러 주차 파일을 함께 주면 현장명으로 묶어 주차별 기록으로 쌓는다 (마지막 주차의 현장 정보가 기준)
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const output = args.find((a) => a.startsWith('--out='))?.slice(6) ?? 'seed/private/seed.json';
const inputs = args.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  console.error('사용법: node scripts/import-excel.mjs <엑셀 경로...> [--out=출력 경로]');
  process.exit(1);
}

let ws;
let reportDate;
let now;

const text = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result != null) return text(v.result);
    if (v.text) return String(v.text);
  }
  return String(v);
};
const cell = (addr) => {
  const v = ws.getCell(addr).value;
  return text(v).replace(/\r/g, '').replace(/(\S)[ \t]{6,}(?=\S)/g, '$1\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
};
const raw = (addr) => ws.getCell(addr).value;

let n = 0;
const id = (p) => `${p}_${(++n).toString(36).padStart(3, '0')}`;


// 부서와 보고자
// 조직도(부서·보고자)는 회사 정보라 저장소 밖 파일에서 읽는다. 형식은 seed/org.example.json 참고
const orgPath = existsSync('seed/private/org.json') ? 'seed/private/org.json' : 'seed/org.example.json';
const org = JSON.parse(readFileSync(orgPath, 'utf8'));
const deptDefs = org.departments.map((d) => [d.name, d.writesSites, d.people.map((m) => [m.name, m.title, m.username])]);
// 엑셀 열 → 현장 칸 부서, 경영지원부 행 분리 규칙
const siteCols = org.siteColumns;
const split = org.splitRows ?? {};

const departments = [];
const members = [
  { id: 'm_ceo', username: 'ceo', name: '대표이사', title: '대표', departmentId: null, isCeo: true, isAdmin: false, active: true, mustChangePassword: false },
  { id: 'm_admin', username: 'admin', name: '취합 담당자', title: '관리자', departmentId: null, isCeo: false, isAdmin: true, active: true, mustChangePassword: false },
];
const memberByName = {};
const deptByName = {};
deptDefs.forEach(([name, writesSites, people], i) => {
  const d = { id: `d_${i + 1}`, name, sort: i + 1, writesSites, active: true };
  departments.push(d);
  deptByName[name] = d;
  people.forEach(([pname, title, username]) => {
    const m = { id: `m_${username.replace('.', '_')}`, username, name: pname, title, departmentId: d.id, isCeo: false, isAdmin: false, active: true, mustChangePassword: false };
    members.push(m);
    memberByName[pname] = m;
  });
});


const sites = [];
const entries = [];
const directives = [];
const addEntry = (kind, deptName, content, extra = {}) => {
  if (!content) return;
  const author = extra.authorId ?? null;
  entries.push({
    id: id('e'), weekId: reportDate, kind, siteId: extra.siteId ?? null,
    departmentId: deptByName[deptName].id, authorId: author, content, updatedAt: now,
    updatedBy: author ?? Object.values(memberByName).find((m) => m.departmentId === deptByName[deptName].id)?.id ?? null,
  });
};
const addDirective = (targetKind, content, extra = {}) => {
  if (!content) return;
  directives.push({ id: id('dv'), weekId: reportDate, targetKind, siteId: extra.siteId ?? null, memberId: extra.memberId ?? null, slot: extra.slot ?? null, content, updatedAt: now });
};

const tagRules = [
  [/잔금/, '잔금대기'], [/설계변경/, '설계변경'], [/대출|금융|은행/, '금융진행'], [/하자/, '하자'],
  [/협력업체 선정/, '협력업체 선정'], [/착공/, '착공준비'],
];

const siteByName = new Map();
let latestSeen = new Set();
const siteKey = (name) => name.replace(/\s/g, '');

function readSites(from, to, stage) {
  for (let r = from; r <= to; r++) {
    const nameCell = cell(`B${r}`);
    if (!nameCell) continue;
    const lines = nameCell.split('\n').map((s) => s.trim()).filter(Boolean);
    const name = lines.shift();
    const note = lines.map((l) => l.replace(/^\(|\)$/g, '').replace(/^-|-$/g, '').trim()).filter(Boolean).join(' · ');
    const due = raw(`C${r}`);
    const dueDate = due instanceof Date ? due.toISOString().slice(0, 10) : null;
    const dueText = dueDate ? '' : cell(`C${r}`);
    const e = raw(`E${r}`);
    const progress = typeof e === 'number' && stage === 'construction' ? Math.round(e * 100) : null;
    const scale = progress == null ? cell(`E${r}`).replace(/\s*\n\s*/g, '') : '';
    let site = siteByName.get(siteKey(name));
    if (!site) {
      site = { id: id('s'), name, tags: [], archived: false, completedAt: null };
      siteByName.set(siteKey(name), site);
      sites.push(site);
    }
    Object.assign(site, { note, stage, dueDate, dueText, process: cell(`D${r}`).replace(/\s*\n\s*/g, ' '), progress, scale, sort: latestSeen.size + 1 });
    latestSeen.add(site.id);
    const all = [cell(`F${r}`), ...Object.keys(siteCols).map((c) => cell(`${c}${r}`))].join('\n');
    site.tags = [...new Set(tagRules.filter(([re]) => re.test(all)).map(([, t]) => t))].slice(0, 3);
    addDirective('site', cell(`F${r}`), { siteId: site.id });
    for (const [col, dept] of Object.entries(siteCols)) addEntry('site', dept, cell(`${col}${r}`), { siteId: site.id });
  }
}

async function importWeek(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  ws = wb.worksheets[0];
  const reportDateMatch = cell('J2').match(/(\d{4}-\d{2}-\d{2})/);
  if (!reportDateMatch) throw new Error(`${path}: J2 칸에서 보고일을 찾지 못했습니다.`);
  reportDate = reportDateMatch[1];
  now = new Date(`${reportDate}T08:00:00+09:00`).toISOString();
  latestSeen = new Set();

// 구간 위치는 제목 행으로 찾는다
const rowOf = (label) => {
  for (let r = 1; r <= ws.rowCount; r++) if (cell(`A${r}`).startsWith(label) || cell(`B${r}`).startsWith(label)) return r;
  return -1;
};
const rCons = rowOf('공사진행현장');
const rCm = rowOf('CM진행현장');
const rSales = rowOf('영업현장');
const rMisc = rowOf('기타사항');
const rDept = rowOf('현장외 부서별도');
readSites(rCons + 2, rCm - 1, 'construction');
readSites(rCm + 2, rSales - 1, 'cm');
readSites(rSales + 2, rMisc - 1, 'sales');

// 기타사항
const strip = (s, re) => s.replace(re, '').trim();
addDirective('misc', strip(cell(`C${rMisc}`), /^대표\s*진행사항\s*/), { slot: 'ceo_progress' });
const reqAll = cell(`F${rMisc}`);
const [req, special = ''] = reqAll.split(/-\s*주간\s*특별\s*지시사항\s*-/);
addDirective('misc', strip(req, /^의뢰진행\s*내용\s*/), { slot: 'requests' });
addDirective('misc', special.trim(), { slot: 'special' });
for (const [col, dept] of Object.entries(siteCols)) addEntry('misc', dept, cell(`${col}${rMisc}`));

// 부서별 보고 (사람별)
const joinCols = (r, cols) => cols.map((c) => cell(`${c}${r}`)).filter(Boolean).join('\n');
const personByReporter = (r) => {
  const reporter = cell(`D${r}`).replace(/\s/g, '');
  return Object.values(memberByName).find((m) => reporter.startsWith(m.name));
};
for (let r = rDept + 2; r <= ws.rowCount; r++) {
  const dept = cell(`B${r}`);
  const reporter = cell(`D${r}`);
  if (!dept && !reporter) continue;
  const rule = Object.entries(split).find(([prefix]) => dept.startsWith(prefix))?.[1];
  if (rule) {
    // 한 행에 여러 사람이 함께 적혀 있어 사람별로 나눈다
    const dir = cell(`F${r}`);
    const pick = (from, to) => {
      const i = dir.indexOf(from);
      if (i < 0) return '';
      const j = to ? dir.indexOf(to, i + 1) : -1;
      return dir.slice(i + from.length, j < 0 ? undefined : j).trim();
    };
    rule.people.forEach((pp, i) => {
      const m = memberByName[pp.name];
      addDirective('member', pick(pp.label, rule.people[i + 1]?.label).replace(/금일 보고받음$/, '').trim(), { memberId: m.id });
      let content = strip(cell(`${pp.column}${r}`), new RegExp(`^${pp.name}\\s*\\S{0,3}\\s*`));
      if (rule.extra?.name === pp.name) content = [content, cell(`${rule.extra.column}${r}`)].filter(Boolean).join('\n\n');
      addEntry('dept', pp.department, content, { authorId: m.id });
    });
    continue;
  }
  const m = personByReporter(r);
  if (!m) continue;
  const deptName = departments.find((d) => d.id === m.departmentId).name;
  addDirective('member', cell(`F${r}`), { memberId: m.id });
  addEntry('dept', deptName, joinCols(r, ['G', 'H', 'I', 'J']), { authorId: m.id });
}
  console.log(`  ${path}: 보고일 ${reportDate}`);
}

// 보고일 순서대로 읽는다 (파일 이름 순서와 무관)
const dated = [];
for (const path of inputs) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  dated.push({ path, date: text(wb.worksheets[0].getCell('J2').value).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '' });
}
dated.sort((a, b) => a.date.localeCompare(b.date));
for (const { path } of dated) await importWeek(path);
for (const s of sites) if (!latestSeen.has(s.id)) s.archived = true;

const grants = (org.grants ?? []).map(([v, t]) => ({ viewerDepartmentId: deptByName[v].id, targetDepartmentId: deptByName[t].id }));

const seed = { reportDate, departments, members, sites, grants, entries, directives, comments: [] };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(seed, null, 2));
console.log(`최신 보고일 ${reportDate} (${dated.length}주): 부서 ${departments.length}, 인원 ${members.length}, 현장 ${sites.length}, 보고 ${entries.length}, 지시 ${directives.length} → ${output}`);
