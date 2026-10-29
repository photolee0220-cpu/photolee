import seed from '@seed';
import { canEditEntry, canSetDirectiveStatus, canViewDept, canViewDirective, isWeekLocked } from './access';
import { ApiError, newId, type Api, type SiteHistoryItem, type WeekSummary } from './api';
import { blobToDataUrl } from './image';
import { DEFAULT_SUMMARY_MODEL, summaryModel } from './models';
import { askClaudeForSummary, askClaudeJson, parseSiteSummary } from './summary';
import { checkAttachable } from './fileTypes';
import { DEFAULT_STAGES, type AiSummary, type AppSettings, type Attachment, type Comment, type Directive, type Entry, type Member, type Photo, type Seed, type SiteSummary, type Snapshot, type StageDef, type WeekId } from './types';

/** 브라우저 안에서만 동작하는 체험용 서버. 실제 서버(Supabase)와 같은 권한 규칙을 따른다 */

const KEY = 'sadakdari-report-demo-v1';
const SESSION = 'sadakdari-report-demo-session';
const DEMO_PASSWORD = '1234';
const LOCKED = '지난 주차 보고는 관리자만 수정할 수 있습니다.';
/** 체험판의 '이번 주' */
export const demoReportWeek: WeekId = (seed as Seed).reportDate;

interface DemoState extends Seed {
  passwords: Record<string, string>;
  photos: Photo[];
  attachments: Attachment[];
  stages: StageDef[];
  summaries: Record<WeekId, AiSummary>;
  history: { entryId: string; content: string; editedBy: string | null; editedAt: string }[];
  siteSummaries: Record<string, SiteSummary>;
  backups: { id: number; createdAt: string; kind: 'auto' | 'manual'; data: string }[];
  settings: AppSettings;
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
  return normalize({ ...s, photos: s.photos ?? [], attachments: s.attachments ?? [], stages: s.stages ?? structuredClone(DEFAULT_STAGES), summaries: {}, history: [], siteSummaries: {}, backups: [], settings: { summaryModel: DEFAULT_SUMMARY_MODEL }, passwords: Object.fromEntries(s.members.map((m) => [m.username, DEMO_PASSWORD])) });
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
      return { weekId: w, entryCount: es.length, writers: new Set(es.map((e) => e.updatedBy)).size };
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
    if (!m.isCeo && !canEditEntry(m, e)) throw new ApiError('피드백을 남길 권한이 없습니다.');
    const c: Comment = { id: newId('c'), entryId, authorId: m.id, content, createdAt: new Date().toISOString(), acknowledgedAt: null, acknowledgedBy: null };
    state.comments.push(c);
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
    const link = document.createElement('a');
    link.href = full.dataUrl;
    link.download = full.fileName;
    link.click();
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
      persist();
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
        isCeo: input.isCeo, isAdmin: input.isAdmin, active: true, mustChangePassword: true,
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
      state.settings = { summaryModel: summaryModel(next.summaryModel).id };
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
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([found.data], { type: 'application/json' }));
      link.download = `sadakdari-backup-${found.createdAt.slice(0, 10)}.json`;
      link.click();
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
