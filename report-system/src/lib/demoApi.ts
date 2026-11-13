import seed from '@seed';
import { affiliationOf, canEditDaily, canEditEntry, canEditEvent, canReviewDaily, canSeeEvent, canSetDayStatus, canSetDirectiveStatus, canViewDept, canViewDirective, isInternalMember, isReviewer, isWeekLocked, writesDaily } from './access';
import { ApiError, newId, type Api, type SiteHistoryItem, type WeekSummary } from './api';
import { blobToDataUrl } from './image';
import { DEFAULT_SUMMARY_MODEL, summaryModel } from './models';
import { shiftDay } from './week';
import { askClaudeForSummary, askClaudeJson, parseSiteSummary } from './summary';
import { checkAttachable, triggerDownload } from './fileTypes';
import { DEFAULT_STAGES, type AiSummary, type AppSettings, type Attachment, type Comment, type Directive, type Entry, type Member, type Photo, type Seed, type SiteField, type CalendarEvent, type DayStatus, type DailyComment, type DailyPhoto, type DailyReport, type SiteSummary, type Snapshot, type StageDef, type WeekId } from './types';

/** 브라우저 안에서만 동작하는 체험용 서버. 실제 서버(Supabase)와 같은 권한 규칙을 따른다 */

const KEY = 'sadakdari-report-demo-v1';
const SESSION = 'sadakdari-report-demo-session';
const DEMO_PASSWORD = '1234';
const LOCKED = '지난 주차 보고는 관리자만 수정할 수 있습니다.';
/** 처음 보여줄 현장 설명 항목 (서버 0009와 같음, 관리자가 지우거나 바꿀 수 있다) */
const DEFAULT_SITE_FIELDS: SiteField[] = [
  { id: 'contract_amount', label: '도급금액', sort: 1 },
  { id: 'client', label: '발주처', sort: 2 },
  { id: 'floor_area', label: '연면적', sort: 3 },
];
/** 체험판의 '이번 주' */
export const demoReportWeek: WeekId = (seed as Seed).reportDate;
/** 체험판의 '오늘': 보고일 직전 금요일 (견본 일일보고가 이 날짜에 있다) */
export const demoToday: string = shiftDay(demoReportWeek, -3);
const DAILY_LOCKED = '일일보고는 당일에만 수정할 수 있습니다.';

interface DemoState extends Seed {
  passwords: Record<string, string>;
  photos: Photo[];
  attachments: Attachment[];
  stages: StageDef[];
  siteFields: SiteField[];
  summaries: Record<WeekId, AiSummary>;
  history: { entryId: string; content: string; editedBy: string | null; editedAt: string }[];
  siteSummaries: Record<string, SiteSummary>;
  backups: { id: number; createdAt: string; kind: 'auto' | 'manual'; data: string }[];
  settings: AppSettings;
  daily: DailyReport[];
  dailyPhotos: DailyPhoto[];
  dailyComments: DailyComment[];
  events: CalendarEvent[];
  dayStatus: DayStatus[];
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k: string, v: string | null): boolean {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch { return false; }
}

/** 기타사항은 없어졌다: 쓴 사람의 부서 업무보고 끝에 '■ 기타사항' 대주제로 옮긴다 (서버 0005와 같은 규칙) */
/** 예전 체험판 데이터에 새 항목을 채운다 */
function normalize(st: DemoState): DemoState {
  st.history ??= [];
  st.siteFields ??= structuredClone(DEFAULT_SITE_FIELDS);
  st.sites.forEach((s) => { s.extra ??= {}; });
  st.members.forEach((m) => { m.isExecutive ??= false; m.affiliation ??= 'hq'; m.homeSiteId ??= null; m.dailyEnabled ??= true; m.noticeAckVersion ??= 1; });
  st.dayStatus ??= structuredClone((seed as Seed).dayStatus ?? []);
  // 예전 체험판 데이터에는 일일보고·일정이 없으므로 견본을 채운다
  st.daily ??= structuredClone((seed as Seed).daily ?? []);
  st.dailyPhotos ??= [];
  st.dailyComments ??= structuredClone((seed as Seed).dailyComments ?? []);
  st.events ??= structuredClone((seed as Seed).events ?? []);
  for (const sm of (seed as Seed).members) if (!st.members.some((x) => x.id === sm.id)) { st.members.push(structuredClone(sm)); st.passwords ??= {}; st.passwords[sm.username] ??= DEMO_PASSWORD; }
  for (const sd of (seed as Seed).departments) if (!st.departments.some((x) => x.id === sd.id)) st.departments.push(structuredClone(sd));
  st.siteSummaries ??= {};
  st.backups ??= [];
  st.directives.forEach((d) => { d.status ??= 'open'; d.statusBy ??= null; d.statusAt ??= null; });
  return foldMisc(st);
}

function foldMisc(st: DemoState): DemoState {
  for (const misc of st.entries.filter((e) => e.kind === 'misc')) {
    const who = st.members.find((m) => m.id === misc.updatedBy) ?? st.members.find((m) => m.active && m.departmentId === misc.departmentId);
    if (!who) continue;
    if (misc.content.trim()) {
      let target = st.entries.find((e) => e.kind === 'dept' && e.weekId === misc.weekId && e.authorId === who.id);
      if (!target) {
        target = { ...misc, id: newId('e'), kind: 'dept', siteId: null, authorId: who.id, departmentId: who.departmentId ?? misc.departmentId, content: '', updatedBy: who.id };
        st.entries.push(target);
      }
      target.content = target.content.trim() ? `${target.content.trimEnd()}\n\n■ 기타사항\n${misc.content}` : `■ 기타사항\n${misc.content}`;
      st.comments.forEach((c) => { if (c.entryId === misc.id) c.entryId = target!.id; });
    }
    st.attachments.forEach((a) => { if (a.kind === 'misc' && a.departmentId === misc.departmentId && a.weekId === misc.weekId) { a.kind = 'dept'; a.authorId = who.id; } });
    st.entries = st.entries.filter((e) => e.id !== misc.id);
  }
  st.attachments.forEach((a) => { if (a.kind === 'misc') { a.kind = 'dept'; a.authorId = a.uploadedBy; } });
  return st;
}

function fresh(): DemoState {
  const s = structuredClone(seed) as Seed;
  return normalize({ ...s, photos: s.photos ?? [], attachments: s.attachments ?? [], stages: s.stages ?? structuredClone(DEFAULT_STAGES), summaries: {}, history: [], siteSummaries: {}, backups: [], daily: s.daily ?? [], dailyPhotos: [], dailyComments: s.dailyComments ?? [], events: s.events ?? [], dayStatus: s.dayStatus ?? [], siteFields: structuredClone(DEFAULT_SITE_FIELDS), settings: { summaryModel: DEFAULT_SUMMARY_MODEL }, passwords: Object.fromEntries(s.members.map((m) => [m.username, DEMO_PASSWORD])) });
}

let state: DemoState = (() => {
  const raw = safeGet(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.reportDate === seed.reportDate) return normalize({ ...parsed, photos: parsed.photos ?? [], attachments: parsed.attachments ?? [], stages: parsed.stages ?? structuredClone(DEFAULT_STAGES), summaries: parsed.summaries ?? {}, settings: parsed.settings ?? { summaryModel: DEFAULT_SUMMARY_MODEL } });
    } catch { /* 손상된 데이터는 초기화 */ }
  }
  return fresh();
})();

const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel(KEY);
  channel.onmessage = () => {
    const raw = safeGet(KEY);
    if (raw) { state = JSON.parse(raw); state.attachments ??= []; state.stages ??= structuredClone(DEFAULT_STAGES); normalize(state); }
    listeners.forEach((l) => l());
  };
} catch { channel = null; }

function persist(): boolean {
  const ok = safeSet(KEY, JSON.stringify(state));
  channel?.postMessage('changed');
  return ok;
}

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 60));

function me(): Member {
  const id = safeGet(SESSION) ?? memSession;
  const m = state.members.find((x) => x.id === id && x.active);
  if (!m) throw new ApiError('로그인이 필요합니다.');
  return m;
}
let memSession: string | null = null;
function setSession(id: string | null) {
  memSession = id;
  safeSet(SESSION, id);
}

function visibleEntries(m: Member, list: Entry[]) {
  return list.filter((e) => canViewDept(m, e.departmentId, state.grants));
}
function visibleDirectives(m: Member, list: Directive[]) {
  return list.filter((d) => canViewDirective(m, d, state.members, state.grants));
}

/** 일일보고 열람: 부서원(부서 안 보고) 보고는 그 부서 안과 관리자만, 나머지는 부서 열람 규칙대로 */
function canSeeDailyOf(m: Member, target: Member | undefined): boolean {
  if (!target) return false;
  if (target.id === m.id) return true;
  if (isInternalMember(target, state.departments)) return m.isAdmin || m.departmentId === target.departmentId;
  return canViewDept(m, target.departmentId, state.grants);
}
const memberById = (id: string) => state.members.find((x) => x.id === id);

function weeksWithData(): WeekId[] {
  const set = new Set<WeekId>([state.reportDate]);
  state.entries.forEach((e) => set.add(e.weekId));
  state.directives.forEach((d) => set.add(d.weekId));
  state.photos.forEach((p) => set.add(p.weekId));
  state.attachments.forEach((a) => set.add(a.weekId));
  return [...set].sort();
}

export const demoApi: Api = {
  mode: 'demo',

  async getSession() {
    try { return await delay(me()); } catch { return null; }
  },
  async signIn(username, password) {
    const m = state.members.find((x) => x.username === username.trim());
    if (!m || state.passwords[m.username] !== password) throw new ApiError('아이디 또는 비밀번호가 맞지 않습니다.');
    if (!m.active) throw new ApiError('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
    setSession(m.id);
    return delay(m);
  },
  async signOut() { setSession(null); },
  async ackNotice() {
    const m = me();
    m.noticeAckVersion = state.settings.noticeVersion ?? 1;
    m.noticeAckAt = new Date().toISOString();
    persist();
  },
  async changePassword(pw) {
    const m = me();
    state.passwords[m.username] = pw;
    m.mustChangePassword = false;
    persist();
  },

  async loadWeek(weekId) {
    const m = me();
    const prevWeekId = weeksWithData().filter((w) => w < weekId).pop() ?? null;
    const snap: Snapshot = {
      weekId,
      departments: state.departments,
      members: state.members,
      sites: state.sites,
      stages: [...state.stages].sort((a, b) => a.sort - b.sort),
      siteFields: [...state.siteFields].sort((a, b) => a.sort - b.sort),
      grants: state.grants,
      entries: visibleEntries(m, state.entries.filter((e) => e.weekId === weekId)),
      directives: visibleDirectives(m, state.directives.filter((d) => d.weekId === weekId)),
      comments: [],
      photos: state.photos.filter((p) => p.weekId === weekId && canViewDept(m, p.departmentId, state.grants)),
      attachments: state.attachments.filter((a) => a.weekId === weekId && canViewDept(m, a.departmentId, state.grants)),
      siteStatus: state.entries.filter((e) => e.weekId === weekId && e.kind === 'site' && e.content.trim())
        .map((e) => ({ siteId: e.siteId!, departmentId: e.departmentId, updatedAt: e.updatedAt })),
      prevWeekId,
      prevEntries: prevWeekId ? visibleEntries(m, state.entries.filter((e) => e.weekId === prevWeekId)) : [],
      prevDirectives: prevWeekId ? visibleDirectives(m, state.directives.filter((d) => d.weekId === prevWeekId)) : [],
    };
    const ids = new Set(snap.entries.map((e) => e.id));
    snap.comments = state.comments.filter((c) => ids.has(c.entryId));
    return delay(structuredClone(snap));
  },

  async listWeeks() {
    const m = me();
    const out: WeekSummary[] = weeksWithData().map((w) => {
      const es = visibleEntries(m, state.entries.filter((e) => e.weekId === w && e.content.trim()));
      return { weekId: w, entryCount: es.length, writers: new Set(es.flatMap((e) => [e.updatedBy, ...(e.writers ?? [])]).filter(Boolean)).size };
    });
    return delay(out.reverse());
  },

  async siteHistory(siteId) {
    const m = me();
    const items: SiteHistoryItem[] = weeksWithData().reverse().map((w) => ({
      weekId: w,
      directive: visibleDirectives(m, state.directives.filter((d) => d.weekId === w && d.siteId === siteId))[0] ?? null,
      entries: visibleEntries(m, state.entries.filter((e) => e.weekId === w && e.siteId === siteId && e.content.trim())),
      photos: state.photos.filter((p) => p.weekId === w && p.siteId === siteId && canViewDept(m, p.departmentId, state.grants)),
    }));
    return delay(items.filter((i) => i.directive?.content || i.entries.length || i.photos.length));
  },

  async saveEntry(input) {
    const m = me();
    if (!canEditEntry(m, input)) throw new ApiError('이 칸을 수정할 권한이 없습니다.');
    if (isWeekLocked(m, input.weekId)) throw new ApiError(LOCKED);
    let e = state.entries.find((x) => x.weekId === input.weekId && x.kind === input.kind && (
      input.kind === 'site' ? x.siteId === input.siteId && x.departmentId === input.departmentId
        : input.kind === 'dept' ? x.authorId === input.authorId
          : x.departmentId === input.departmentId));
    if (!e) {
      e = { id: newId('e'), ...input, updatedAt: '', updatedBy: null };
      state.entries.push(e);
    }
    // 서버 keep_entry_history와 같은 규칙: 같은 사람이 10분 안에 이어 고친 것은 한 번으로
    if (e.content !== input.content && e.content.trim()
      && (e.updatedBy !== m.id || Date.now() - Date.parse(e.updatedAt) > 10 * 60 * 1000)) {
      state.history.push({ entryId: e.id, content: e.content, editedBy: e.updatedBy, editedAt: e.updatedAt });
    }
    e.content = input.content;
    e.updatedAt = new Date().toISOString();
    e.updatedBy = m.id;
    if (input.content.trim() && !(e.writers ?? []).includes(m.id)) e.writers = [...(e.writers ?? []), m.id];
    persist();
    return structuredClone(e);
  },

  async saveDirective(input) {
    const m = me();
    if (!m.isCeo) throw new ApiError('대표님 지시사항은 대표님만 입력할 수 있습니다.');
    let d = state.directives.find((x) => x.weekId === input.weekId && x.targetKind === input.targetKind
      && x.siteId === input.siteId && x.memberId === input.memberId && x.slot === input.slot);
    if (!d) {
      d = { id: newId('dv'), ...input, updatedAt: '', status: 'open', statusBy: null, statusAt: null };
      state.directives.push(d);
    }
    d.content = input.content;
    d.updatedAt = new Date().toISOString();
    persist();
    return structuredClone(d);
  },

  async addComment(entryId, content) {
    const m = me();
    const e = state.entries.find((x) => x.id === entryId);
    if (!e) throw new ApiError('보고 내용을 찾을 수 없습니다.');
    if (!isReviewer(m) && !canEditEntry(m, e)) throw new ApiError('피드백을 남길 권한이 없습니다.');
    const c: Comment = { id: newId('c'), entryId, authorId: m.id, content, createdAt: new Date().toISOString(), acknowledgedAt: null, acknowledgedBy: null };
    state.comments.push(c);
    persist();
    return structuredClone(c);
  },

  async editComment(id, content) {
    const m = me();
    const c = state.comments.find((x) => x.id === id);
    if (!c || c.authorId !== m.id) throw new ApiError('본인이 쓴 글만 고칠 수 있습니다.');
    if (c.acknowledgedAt) throw new ApiError('상대가 이미 확인해서 고칠 수 없습니다.');
    c.content = content;
    c.editedAt = new Date().toISOString();
    persist();
    return structuredClone(c);
  },

  async acknowledgeComment(id) {
    const m = me();
    const c = state.comments.find((x) => x.id === id);
    const e = c && state.entries.find((x) => x.id === c.entryId);
    if (!c || !e || !canEditEntry(m, e)) throw new ApiError('확인 처리할 권한이 없습니다.');
    c.acknowledgedAt = new Date().toISOString();
    c.acknowledgedBy = m.id;
    persist();
  },

  async deleteComment(id) {
    const m = me();
    const c = state.comments.find((x) => x.id === id);
    if (!c || c.authorId !== m.id) throw new ApiError('본인이 쓴 글만 지울 수 있습니다.');
    state.comments = state.comments.filter((x) => x.id !== id);
    persist();
  },

  async uploadPhoto(input) {
    const m = me();
    if (!canEditEntry(m, { kind: 'site', departmentId: input.departmentId, authorId: null })) throw new ApiError('이 현장 칸에 사진을 올릴 권한이 없습니다.');
    if (isWeekLocked(m, input.weekId)) throw new ApiError(LOCKED);
    const photo: Photo = {
      id: newId('p'), weekId: input.weekId, siteId: input.siteId, departmentId: input.departmentId, uploadedBy: m.id,
      caption: input.caption, createdAt: new Date().toISOString(), width: input.width, height: input.height,
      url: await blobToDataUrl(input.blob),
    };
    state.photos.push(photo);
    if (!persist()) {
      state.photos = state.photos.filter((p) => p.id !== photo.id);
      persist();
      throw new ApiError('체험판은 브라우저 저장 공간이 작아 사진을 더 올릴 수 없습니다. 실제 서버에서는 제한이 없습니다.');
    }
    return structuredClone(photo);
  },

  async deletePhoto(id) {
    const m = me();
    const p = state.photos.find((x) => x.id === id);
    if (!p || (p.uploadedBy !== m.id && !m.isAdmin)) throw new ApiError('올린 사람이나 관리자만 지울 수 있습니다.');
    if (isWeekLocked(m, p.weekId)) throw new ApiError(LOCKED);
    state.photos = state.photos.filter((x) => x.id !== id);
    persist();
  },

  async uploadAttachment(input) {
    const m = me();
    if (!canEditEntry(m, input)) throw new ApiError('이 칸에 파일을 올릴 권한이 없습니다.');
    if (isWeekLocked(m, input.weekId)) throw new ApiError(LOCKED);
    const bad = checkAttachable(input.file);
    if (bad) throw new ApiError(bad);
    if (input.file.size > 2 * 1024 * 1024) throw new ApiError('체험판은 브라우저 저장 공간이 작아 2MB까지만 올릴 수 있습니다. 실제 서버는 20MB까지 됩니다.');
    const a: Attachment = {
      id: newId('f'), weekId: input.weekId, kind: input.kind, siteId: input.siteId, departmentId: input.departmentId, authorId: input.authorId,
      fileName: input.file.name, sizeBytes: input.file.size, mimeType: input.file.type || 'application/octet-stream',
      uploadedBy: m.id, createdAt: new Date().toISOString(), dataUrl: await blobToDataUrl(input.file),
    };
    state.attachments.push(a);
    if (!persist()) {
      state.attachments = state.attachments.filter((x) => x.id !== a.id);
      persist();
      throw new ApiError('체험판은 브라우저 저장 공간이 작아 파일을 더 올릴 수 없습니다. 실제 서버에서는 제한이 없습니다.');
    }
    return structuredClone(a);
  },

  async deleteAttachment(id) {
    const m = me();
    const a = state.attachments.find((x) => x.id === id);
    if (!a || (a.uploadedBy !== m.id && !m.isAdmin)) throw new ApiError('올린 사람이나 관리자만 지울 수 있습니다.');
    if (isWeekLocked(m, a.weekId)) throw new ApiError(LOCKED);
    state.attachments = state.attachments.filter((x) => x.id !== id);
    persist();
  },

  async downloadAttachment(a) {
    const full = state.attachments.find((x) => x.id === a.id);
    if (!full?.dataUrl) throw new ApiError('파일을 찾을 수 없습니다.');
    triggerDownload(full.dataUrl, full.fileName);
  },

  async getAiSummary(weekId) {
    const m = me();
    if (!m.isCeo) return null;
    return delay(state.summaries[weekId] ?? null);
  },

  async generateAiSummary(weekId, prompt, sourceUpdatedAt) {
    const m = me();
    if (!m.isCeo) throw new ApiError('AI 요약은 대표님 화면에서만 만들 수 있습니다.');
    const model = summaryModel(state.settings.summaryModel);
    const result = await askClaudeForSummary(prompt, model);
    const summary: AiSummary = { weekId, ...result, model: model.id, generatedAt: new Date().toISOString(), sourceUpdatedAt };
    state.summaries[weekId] = summary;
    persist();
    return structuredClone(summary);
  },

  async setDirectiveStatus(id, status) {
    const m = me();
    const d = state.directives.find((x) => x.id === id);
    if (!d) throw new ApiError('지시사항을 찾을 수 없습니다.');
    const writesSites = !!state.departments.find((x) => x.id === m.departmentId)?.writesSites;
    if (!canSetDirectiveStatus(m, d, writesSites)) throw new ApiError('이 지시사항의 처리 상태를 바꿀 권한이 없습니다.');
    d.status = status;
    d.statusBy = m.id;
    d.statusAt = new Date().toISOString();
    persist();
    return structuredClone(d);
  },

  async directiveHistory() {
    const m = me();
    return delay(visibleDirectives(m, state.directives.filter((d) => (d.targetKind === 'site' || d.targetKind === 'member') && d.content.trim()))
      .sort((a, b) => b.weekId.localeCompare(a.weekId)).map((d) => structuredClone(d)));
  },

  async pendingFeedback() {
    const m = me();
    if (isReviewer(m)) return [];
    const reviewers = new Set(state.members.filter(isReviewer).map((x) => x.id));
    const entries = new Map(state.entries.map((e) => [e.id, e]));
    return delay(state.comments
      .filter((c) => !c.acknowledgedAt && reviewers.has(c.authorId))
      .map((c) => ({ comment: c, entry: entries.get(c.entryId)! }))
      .filter(({ entry }) => entry && (entry.kind === 'dept' ? entry.authorId === m.id : entry.departmentId === m.departmentId))
      .sort((a, b) => b.comment.createdAt.localeCompare(a.comment.createdAt))
      .map((x) => structuredClone(x)));
  },

  async entryHistory(entryId) {
    const m = me();
    const e = state.entries.find((x) => x.id === entryId);
    if (!e || !canViewDept(m, e.departmentId, state.grants)) return [];
    return delay(state.history.filter((h) => h.entryId === entryId).sort((a, b) => b.editedAt.localeCompare(a.editedAt))
      .map((h) => ({ content: h.content, editedBy: h.editedBy, editedAt: h.editedAt })));
  },

  async getSiteSummary(siteId) {
    const m = me();
    if (!m.isCeo && !m.isAdmin) return null;
    return delay(state.siteSummaries[siteId] ?? null);
  },

  async generateSiteSummary(siteId, months, prompt) {
    const m = me();
    if (!m.isCeo && !m.isAdmin) throw new ApiError('현장 기간 요약은 대표님과 관리자만 만들 수 있습니다.');
    const model = summaryModel(state.settings.summaryModel);
    const r = parseSiteSummary(await askClaudeJson(prompt, model));
    const s: SiteSummary = { siteId, months, ...r, model: model.id, generatedAt: new Date().toISOString() };
    state.siteSummaries[siteId] = s;
    persist();
    return structuredClone(s);
  },

  push: {
    available: false,
    async publicKey() { throw new ApiError('체험판에서는 알림을 쓸 수 없습니다.'); },
    async save() { throw new ApiError('체험판에서는 알림을 쓸 수 없습니다.'); },
    async remove() { /* 체험판은 저장하지 않음 */ },
    async test() { throw new ApiError('체험판에서는 알림을 쓸 수 없습니다.'); },
  },

  async getSettings() {
    me();
    return delay(structuredClone(state.settings));
  },

  daily: {
    async load(date) {
      const m = me();
      const see = (id: string) => canSeeDailyOf(m, memberById(id));
      return delay(structuredClone({
        date,
        reports: state.daily.filter((r) => r.date === date && see(r.authorId)),
        photos: state.dailyPhotos.filter((p) => p.date === date && see(p.authorId)),
        comments: state.dailyComments.filter((c) => c.date === date && (c.authorId === m.id || see(c.memberId))),
        statuses: state.dayStatus.filter((x) => x.startDate <= date && x.endDate >= date && see(x.memberId)),
      }));
    },
    async save(input) {
      const m = me();
      if (!writesDaily(m)) throw new ApiError('일일보고를 쓰는 계정이 아닙니다.');
      if (!canEditDaily(m, m.id, input.date)) throw new ApiError(DAILY_LOCKED);
      const kind = affiliationOf(m);
      if (kind === 'site' && input.siteId !== m.homeSiteId) throw new ApiError('소속 현장 칸에만 쓸 수 있습니다. 관리자에게 소속 현장 지정을 요청하세요.');
      const i = state.daily.findIndex((r) => r.date === input.date && r.authorId === m.id && r.siteId === input.siteId);
      if (!input.content.trim()) {
        if (i >= 0) state.daily.splice(i, 1);
        persist();
        return null;
      }
      const r: DailyReport = {
        id: i >= 0 ? state.daily[i].id : newId('dr'), date: input.date, authorId: m.id, departmentId: m.departmentId!, siteId: input.siteId,
        authorKind: kind, internal: isInternalMember(m, state.departments), content: input.content, updatedAt: new Date().toISOString(),
      };
      if (i >= 0) state.daily[i] = r; else state.daily.push(r);
      persist();
      return structuredClone(r);
    },
    async uploadPhoto(input) {
      const m = me();
      if (!writesDaily(m) || !canEditDaily(m, m.id, input.date)) throw new ApiError(DAILY_LOCKED);
      const p: DailyPhoto = {
        id: newId('dp'), date: input.date, authorId: m.id, departmentId: m.departmentId!, siteId: input.siteId, internal: isInternalMember(m, state.departments),
        width: input.width, height: input.height, createdAt: new Date().toISOString(), url: await blobToDataUrl(input.blob),
      };
      state.dailyPhotos.push(p);
      if (!persist()) {
        state.dailyPhotos = state.dailyPhotos.filter((x) => x.id !== p.id);
        persist();
        throw new ApiError('체험판은 브라우저 저장 공간이 작아 사진을 더 올릴 수 없습니다. 실제 서버에서는 제한이 없습니다.');
      }
      return structuredClone(p);
    },
    async deletePhoto(id) {
      const m = me();
      const p = state.dailyPhotos.find((x) => x.id === id);
      if (!p || !canEditDaily(m, p.authorId, p.date)) throw new ApiError('올린 사람이 당일에만 지울 수 있습니다.');
      state.dailyPhotos = state.dailyPhotos.filter((x) => x.id !== id);
      persist();
    },
    async addComment(date, memberId, content) {
      const m = me();
      const target = memberById(memberId);
      if (!target || (m.id !== memberId && !canReviewDaily(m, target, state.departments))) throw new ApiError('피드백을 남길 권한이 없습니다.');
      if (!state.daily.some((r) => r.authorId === memberId && r.date === date && r.content.trim()) && !state.dailyPhotos.some((p) => p.authorId === memberId && p.date === date)) {
        throw new ApiError('작성한 일일보고에만 피드백을 남길 수 있습니다.');
      }
      const c: DailyComment = { id: newId('dc'), date, memberId, authorId: m.id, content, createdAt: new Date().toISOString(), editedAt: null, acknowledgedAt: null };
      state.dailyComments.push(c);
      persist();
      return structuredClone(c);
    },
    async editComment(id, content) {
      const m = me();
      const c = state.dailyComments.find((x) => x.id === id);
      if (!c || c.authorId !== m.id) throw new ApiError('본인이 쓴 글만 고칠 수 있습니다.');
      if (c.acknowledgedAt) throw new ApiError('상대가 이미 확인해서 고칠 수 없습니다.');
      c.content = content;
      c.editedAt = new Date().toISOString();
      persist();
      return structuredClone(c);
    },
    async acknowledge(id) {
      const m = me();
      const c = state.dailyComments.find((x) => x.id === id);
      if (!c || c.memberId !== m.id) throw new ApiError('본인 보고에 달린 피드백만 확인할 수 있습니다.');
      c.acknowledgedAt = new Date().toISOString();
      persist();
    },
    async deleteComment(id) {
      const m = me();
      const c = state.dailyComments.find((x) => x.id === id);
      if (!c || c.authorId !== m.id) throw new ApiError('본인이 쓴 글만 지울 수 있습니다.');
      state.dailyComments = state.dailyComments.filter((x) => x.id !== id);
      persist();
    },
    async pending() {
      const m = me();
      return delay(structuredClone(state.dailyComments.filter((c) => {
        const a = memberById(c.authorId);
        return c.memberId === m.id && !c.acknowledgedAt && !!a && canReviewDaily(a, m, state.departments);
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
    },
    async statuses(from, to) {
      const m = me();
      return delay(structuredClone(state.dayStatus.filter((x) => x.startDate <= to && x.endDate >= from && canSeeDailyOf(m, memberById(x.memberId)))
        .sort((a, b) => a.startDate.localeCompare(b.startDate))));
    },
    async saveStatus(st) {
      const m = me();
      const target = memberById(st.memberId);
      if (!target || !canSetDayStatus(m, target, state.departments)) throw new ApiError('근무 상태를 등록할 권한이 없습니다.');
      if (!st.startDate || st.endDate < st.startDate) throw new ApiError('날짜를 확인해 주세요.');
      const i = state.dayStatus.findIndex((x) => x.id === st.id);
      const next: DayStatus = { ...st, memo: st.memo.trim(), createdBy: i >= 0 ? state.dayStatus[i].createdBy : m.id, createdAt: i >= 0 ? state.dayStatus[i].createdAt : new Date().toISOString() };
      if (i >= 0) state.dayStatus[i] = next; else state.dayStatus.push(next);
      persist();
      return structuredClone(next);
    },
    async removeStatus(id) {
      const m = me();
      const x = state.dayStatus.find((v) => v.id === id);
      const target = x && memberById(x.memberId);
      if (!x || !target || !canSetDayStatus(m, target, state.departments)) throw new ApiError('지울 권한이 없습니다.');
      state.dayStatus = state.dayStatus.filter((v) => v.id !== id);
      persist();
    },
  },

  ask: {
    async corpus(from) {
      const m = me();
      if (!m.isCeo) throw new ApiError('대표님만 쓸 수 있습니다.');
      return delay([
        ...state.entries.filter((e) => e.weekId >= from && e.content.trim()).map((e) => ({
          id: e.id, kind: 'weekly' as const, date: e.weekId, siteId: e.siteId, departmentId: e.departmentId, memberId: e.kind === 'dept' ? e.authorId : null, content: e.content,
        })),
        ...state.directives.filter((d) => d.weekId >= from && d.content.trim() && (d.targetKind === 'site' || d.targetKind === 'member')).map((d) => ({
          id: d.id, kind: 'directive' as const, date: d.weekId, siteId: d.siteId, departmentId: null, memberId: d.memberId, content: d.content, status: d.status,
        })),
        ...state.daily.filter((r) => r.date >= from && r.content.trim() && !r.internal).map((r) => ({
          id: r.id, kind: 'daily' as const, date: r.date, siteId: r.siteId, departmentId: r.departmentId, memberId: r.authorId, content: r.content,
        })),
      ]);
    },
    async answer(prompt) {
      const m = me();
      if (!m.isCeo) throw new ApiError('대표님만 쓸 수 있습니다.');
      const model = summaryModel(state.settings.summaryModel);
      const v = (await askClaudeJson(prompt, model)) as { answer?: unknown; sourceIds?: unknown } | null;
      if (typeof v?.answer !== 'string') throw new ApiError('답을 읽지 못했습니다. 다시 물어봐 주세요.');
      return { answer: v.answer, sourceIds: Array.isArray(v.sourceIds) ? v.sourceIds.map(String) : [], model: model.id };
    },
  },

  calendar: {
    async list(from, to) {
      const m = me();
      return delay(structuredClone(state.events.filter((e) => e.startDate <= to && e.endDate >= from && canSeeEvent(m, e, state.grants))
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.time.localeCompare(b.time))));
    },
    async save(e) {
      const m = me();
      if (!e.title.trim()) throw new ApiError('일정 제목을 입력해 주세요.');
      if (e.endDate < e.startDate) throw new ApiError('끝나는 날이 시작일보다 빠릅니다.');
      const i = state.events.findIndex((x) => x.id === e.id);
      if (i >= 0 && !canEditEvent(m, state.events[i])) throw new ApiError('만든 사람이나 관리자만 고칠 수 있습니다.');
      const prev = i >= 0 ? state.events[i] : null;
      const departmentId = prev ? prev.departmentId : m.departmentId;
      const next: CalendarEvent = {
        ...e, title: e.title.trim(), memo: e.memo.trim(), createdBy: prev?.createdBy ?? m.id, departmentId,
        scope: departmentId ? e.scope : 'all', updatedAt: new Date().toISOString(),
      };
      if (i >= 0) state.events[i] = next; else state.events.push(next);
      persist();
      return structuredClone(next);
    },
    async remove(id) {
      const m = me();
      const e = state.events.find((x) => x.id === id);
      if (!e || !canEditEvent(m, e)) throw new ApiError('만든 사람이나 관리자만 지울 수 있습니다.');
      state.events = state.events.filter((x) => x.id !== id);
      persist();
    },
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },

  admin: {
    async saveSite(site) {
      requireAdmin();
      const i = state.sites.findIndex((s) => s.id === site.id);
      if (i >= 0) state.sites[i] = site; else state.sites.push(site);
      persist();
      return structuredClone(site);
    },
    async deleteSite(id) {
      requireAdmin();
      const gone = new Set(state.entries.filter((e) => e.siteId === id).map((e) => e.id));
      state.comments = state.comments.filter((c) => !gone.has(c.entryId));
      state.entries = state.entries.filter((e) => e.siteId !== id);
      state.directives = state.directives.filter((d) => d.siteId !== id);
      state.photos = state.photos.filter((p) => p.siteId !== id);
      state.attachments = state.attachments.filter((a) => a.siteId !== id);
      state.sites = state.sites.filter((s) => s.id !== id);
      state.daily = state.daily.filter((r) => r.siteId !== id);
      state.dailyPhotos = state.dailyPhotos.filter((p) => p.siteId !== id);
      state.events = state.events.map((e) => (e.siteId === id ? { ...e, siteId: null } : e));
      state.members.forEach((m) => { if (m.homeSiteId === id) m.homeSiteId = null; });
      persist();
    },
    async saveSiteField(f) {
      requireAdmin();
      if (!f.label.trim()) throw new ApiError('항목 이름을 입력해 주세요.');
      const next = { ...f, label: f.label.trim() };
      const i = state.siteFields.findIndex((x) => x.id === f.id);
      if (i >= 0) state.siteFields[i] = next; else state.siteFields.push(next);
      persist();
      return structuredClone(next);
    },
    async deleteSiteField(id) {
      requireAdmin();
      state.siteFields = state.siteFields.filter((x) => x.id !== id);
      state.sites.forEach((s) => { delete s.extra[id]; });
      persist();
    },
    async listMedia(from, before) {
      requireAdmin();
      const inRange = (w: string) => w < before && (!from || w >= from);
      return delay([
        ...state.photos.filter((p) => inRange(p.weekId)).map((p) => ({
          kind: 'photo' as const, weekId: p.weekId, departmentId: p.departmentId, siteId: p.siteId, authorId: null,
          fileName: `사진.jpg`, sizeBytes: Math.round((p.url.length * 3) / 4), url: p.url,
        })),
        ...state.attachments.filter((a) => inRange(a.weekId)).map((a) => ({
          kind: 'file' as const, weekId: a.weekId, departmentId: a.departmentId, siteId: a.siteId, authorId: a.authorId,
          fileName: a.fileName, sizeBytes: a.sizeBytes, url: a.dataUrl ?? '',
        })),
      ]);
    },
    async saveStage(st) {
      requireAdmin();
      if (!st.short.trim()) throw new ApiError('단계 이름을 입력해 주세요.');
      if (state.stages.some((x) => x.id !== st.id && x.short === st.short.trim())) throw new ApiError('같은 이름의 단계가 이미 있습니다.');
      const next = { ...st, short: st.short.trim(), label: st.label.trim() || st.short.trim() };
      const i = state.stages.findIndex((x) => x.id === st.id);
      if (i >= 0) state.stages[i] = next; else state.stages.push(next);
      persist();
      return structuredClone(next);
    },
    async deleteStage(id) {
      requireAdmin();
      if (state.sites.some((s) => s.stage === id)) throw new ApiError('이 단계에 현장이 있어 지울 수 없습니다. 현장을 다른 단계로 옮기거나 보관함의 현장도 확인해 주세요.');
      state.stages = state.stages.filter((x) => x.id !== id);
      persist();
    },
    async saveDepartment(d) {
      requireAdmin();
      const i = state.departments.findIndex((x) => x.id === d.id);
      if (i >= 0) state.departments[i] = d; else state.departments.push(d);
      persist();
      return structuredClone(d);
    },
    async deleteDepartment(id) {
      requireAdmin();
      if (state.members.some((m) => m.departmentId === id && m.active)) throw new ApiError('소속 인원이 있는 부서는 삭제할 수 없습니다. 먼저 인원을 다른 부서로 옮겨주세요.');
      if (state.entries.some((e) => e.departmentId === id)) throw new ApiError('보고 기록이 있는 부서는 삭제 대신 사용 중지로 바꿔주세요.');
      state.departments = state.departments.filter((d) => d.id !== id);
      state.grants = state.grants.filter((g) => g.viewerDepartmentId !== id && g.targetDepartmentId !== id);
      persist();
    },
    async setGrants(viewer, targets) {
      requireAdmin();
      state.grants = state.grants.filter((g) => g.viewerDepartmentId !== viewer)
        .concat(targets.filter((t) => t !== viewer).map((t) => ({ viewerDepartmentId: viewer, targetDepartmentId: t })));
      persist();
      return structuredClone(state.grants);
    },
    async createMember(input) {
      requireAdmin();
      if (state.members.some((m) => m.username === input.username)) throw new ApiError('이미 사용 중인 아이디입니다.');
      const m: Member = {
        id: newId('m'), username: input.username, name: input.name, title: input.title, departmentId: input.departmentId,
        isCeo: input.isCeo, isAdmin: input.isAdmin, isExecutive: input.isExecutive, active: true, mustChangePassword: true,
        affiliation: input.affiliation, homeSiteId: input.affiliation === 'site' ? input.homeSiteId : null, dailyEnabled: input.dailyEnabled,
      };
      state.members.push(m);
      state.passwords[m.username] = input.password;
      persist();
      return structuredClone(m);
    },
    async updateMember(m) {
      const actor = requireAdmin();
      if (actor.id === m.id && !m.isAdmin) throw new ApiError('본인의 관리자 권한은 해제할 수 없습니다.');
      const i = state.members.findIndex((x) => x.id === m.id);
      if (i < 0) throw new ApiError('인원을 찾을 수 없습니다.');
      state.members[i] = m;
      persist();
      return structuredClone(m);
    },
    async saveSettings(next) {
      requireAdmin();
      state.settings = { summaryModel: summaryModel(next.summaryModel).id, layersUrl: (next.layersUrl ?? '').trim(), ai: next.ai, reportNotice: next.reportNotice, noticeVersion: next.noticeVersion ?? state.settings.noticeVersion ?? 1 };
      persist();
      return structuredClone(state.settings);
    },
    async storageUsage() {
      requireAdmin();
      const size = (u: string | undefined) => Math.round(((u?.length ?? 0) * 3) / 4);
      return {
        photoCount: state.photos.length,
        photoBytes: state.photos.reduce((n, p) => n + size(p.url), 0),
        fileCount: state.attachments.length,
        fileBytes: state.attachments.reduce((n, a) => n + a.sizeBytes, 0),
        estimated: false,
      };
    },
    async cleanupMedia(before) {
      requireAdmin();
      const oldPhotos = state.photos.filter((p) => p.weekId < before);
      const oldFiles = state.attachments.filter((a) => a.weekId < before);
      const bytes = oldPhotos.reduce((n, p) => n + Math.round((p.url.length * 3) / 4), 0) + oldFiles.reduce((n, a) => n + a.sizeBytes, 0);
      state.photos = state.photos.filter((p) => p.weekId >= before);
      state.attachments = state.attachments.filter((a) => a.weekId >= before);
      persist();
      return { photos: oldPhotos.length, files: oldFiles.length, bytes };
    },
    async listBackups() {
      requireAdmin();
      return delay(state.backups.map((b) => ({ id: b.id, createdAt: b.createdAt, kind: b.kind, sizeBytes: b.data.length })).reverse());
    },
    async createBackup() {
      const m = requireAdmin();
      const { passwords: _pw, backups: _b, ...rest } = state;
      void _pw; void _b;
      state.backups.push({ id: Date.now(), createdAt: new Date().toISOString(), kind: 'manual', data: JSON.stringify({ version: 1, created_by: m.id, tables: rest }) });
      state.backups = state.backups.slice(-12);
      if (!persist()) { state.backups.pop(); persist(); throw new ApiError('체험판은 브라우저 저장 공간이 작아 백업을 더 만들 수 없습니다.'); }
    },
    async downloadBackup(b) {
      requireAdmin();
      const found = state.backups.find((x) => x.id === b.id);
      if (!found) throw new ApiError('백업을 찾을 수 없습니다.');
      triggerDownload(URL.createObjectURL(new Blob([found.data], { type: 'application/json' })), `sadakdari-backup-${found.createdAt.slice(0, 10)}.json`);
    },
    async pushMembers() {
      requireAdmin();
      return [];
    },
    async changeUsername(memberId, username) {
      requireAdmin();
      const next = username.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(next)) throw new ApiError('아이디는 영문 소문자, 숫자, 점(.)으로 3~30자여야 합니다.');
      if (state.members.some((m) => m.username === next && m.id !== memberId)) throw new ApiError('이미 사용 중인 아이디입니다.');
      const m = state.members.find((x) => x.id === memberId);
      if (!m) throw new ApiError('인원을 찾을 수 없습니다.');
      state.passwords[next] = state.passwords[m.username];
      if (next !== m.username) delete state.passwords[m.username];
      m.username = next;
      persist();
      return structuredClone(m);
    },
    async resetPassword(memberId, pw) {
      requireAdmin();
      const m = state.members.find((x) => x.id === memberId);
      if (!m) throw new ApiError('인원을 찾을 수 없습니다.');
      state.passwords[m.username] = pw;
      m.mustChangePassword = true;
      persist();
    },
  },

  demo: {
    accounts: () => state.members.filter((m) => m.active),
    async signInAs(id) {
      setSession(id);
      return me();
    },
    reset() {
      state = fresh();
      persist();
    },
  },
};

function requireAdmin(): Member {
  const m = me();
  if (!m.isAdmin) throw new ApiError('관리자만 할 수 있습니다.');
  return m;
}

export const DEMO_DEFAULT_PASSWORD = DEMO_PASSWORD;
