import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Api, type SiteHistoryItem } from './api';
import { DEFAULT_SUMMARY_MODEL } from './models';
import { parseSummary } from './summary';
import { checkAttachable, extOf, triggerDownload } from './fileTypes';
import type { AiSummary, AppSettings, Attachment, CalendarEvent, Comment, DailyComment, DailyPhoto, DailyReport, DayStatus, Department, Directive, Entry, Grant, Member, Photo, Site, SiteSummary, Snapshot, StageDef } from './types';

const BUCKET = 'site-photos';
const FILES = 'report-files';
const DAILY = 'daily-photos';
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toDept = (r: Row): Department => ({ id: r.id, name: r.name, sort: r.sort, writesSites: r.writes_sites, active: r.active, internalReport: !!r.internal_report, headId: r.head_id ?? null });
const toMember = (r: Row): Member => ({
  id: r.id, username: r.username, name: r.name, title: r.title, departmentId: r.department_id,
  isCeo: r.is_ceo, isAdmin: r.is_admin, isExecutive: !!r.is_executive, active: r.active, mustChangePassword: r.must_change_password,
  affiliation: r.affiliation ?? 'hq', homeSiteId: r.home_site_id ?? null, dailyEnabled: r.daily_enabled !== false,
});
const toDaily = (r: Row): DailyReport => ({
  id: r.id, date: r.date, authorId: r.author_id, departmentId: r.department_id, siteId: r.site_id, authorKind: r.author_kind,
  internal: !!r.internal, content: r.content, updatedAt: r.updated_at,
});
const toDailyComment = (r: Row): DailyComment => ({
  id: r.id, date: r.date, memberId: r.member_id, authorId: r.author_id, content: r.content, createdAt: r.created_at,
  editedAt: r.edited_at ?? null, acknowledgedAt: r.acknowledged_at ?? null,
});
const toStatus = (r: Row): DayStatus => ({
  id: r.id, memberId: r.member_id, startDate: r.start_date, endDate: r.end_date, kind: r.kind, memo: r.memo ?? '', createdBy: r.created_by ?? '', createdAt: r.created_at,
});
const toEvent = (r: Row): CalendarEvent => ({
  id: r.id, title: r.title, startDate: r.start_date, endDate: r.end_date, time: r.time ?? '', siteId: r.site_id, scope: r.scope,
  departmentId: r.department_id, memo: r.memo ?? '', createdBy: r.created_by ?? '', updatedAt: r.updated_at,
});
const toSite = (r: Row): Site => ({
  id: r.id, name: r.name, note: r.note, stage: r.stage, dueDate: r.due_date, dueText: r.due_text, process: r.process,
  progress: r.progress == null ? null : Number(r.progress), scale: r.scale, tags: r.tags ?? [], sort: r.sort,
  archived: r.archived, completedAt: r.completed_at, extra: r.extra ?? {},
});
const toStage = (r: Row): StageDef => ({ id: r.id, label: r.label, short: r.short, sort: r.sort });
const toGrant = (r: Row): Grant => ({ viewerDepartmentId: r.viewer_department_id, targetDepartmentId: r.target_department_id });
const toEntry = (r: Row): Entry => ({
  id: r.id, weekId: r.week_id, kind: r.kind, siteId: r.site_id, departmentId: r.department_id, authorId: r.author_id,
  content: r.content, updatedAt: r.updated_at, updatedBy: r.updated_by, writers: r.writers ?? [],
});
const toDirective = (r: Row): Directive => ({
  id: r.id, weekId: r.week_id, targetKind: r.target_kind, siteId: r.site_id, memberId: r.member_id, slot: r.slot,
  content: r.content, updatedAt: r.updated_at, status: r.status ?? 'open', statusBy: r.status_by ?? null, statusAt: r.status_at ?? null,
});
const toSiteSummary = (r: Row): SiteSummary => ({
  siteId: r.site_id, months: r.months, overview: r.overview, milestones: r.milestones ?? [], issues: r.issues ?? [], model: r.model ?? '', generatedAt: r.generated_at,
});
const toComment = (r: Row): Comment => ({
  id: r.id, entryId: r.entry_id, authorId: r.author_id, content: r.content, createdAt: r.created_at,
  editedAt: r.edited_at ?? null, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
});

const toAttachment = (r: Row): Attachment => ({
  id: r.id, weekId: r.week_id, kind: r.kind, siteId: r.site_id, departmentId: r.department_id, authorId: r.author_id,
  fileName: r.file_name, sizeBytes: Number(r.size_bytes), mimeType: r.mime_type, uploadedBy: r.uploaded_by, createdAt: r.created_at,
});

const toSummary = (r: Row): AiSummary => ({
  weekId: r.week_id, highlights: r.highlights ?? [], siteChanges: r.site_changes ?? [],
  generatedAt: r.generated_at, model: r.model ?? '', sourceUpdatedAt: r.source_updated_at ?? '',
});

function check(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new ApiError(res.error.message);
  return res.data;
}

export function createSupabaseApi(url: string, anonKey: string, emailDomain: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey);
  const email = (username: string) => `${username.trim().toLowerCase()}@${emailDomain}`;

  async function currentMember(): Promise<Member | null> {
    const { data } = await sb.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return null;
    const r = await sb.from('members').select('*').eq('id', uid).maybeSingle();
    return r.data && r.data.active ? toMember(r.data) : null;
  }

  /** 비공개 저장소의 사진은 잠깐 쓰는 서명 주소로 보여준다 */
  async function withUrls(rows: Row[]): Promise<Photo[]> {
    if (!rows.length) return [];
    const signed = await sb.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60 * 6);
    const urls = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
    return rows.map((r) => ({
      id: r.id, weekId: r.week_id, siteId: r.site_id, departmentId: r.department_id, uploadedBy: r.uploaded_by,
      caption: r.caption ?? '', createdAt: r.created_at, width: r.width ?? 0, height: r.height ?? 0, url: urls.get(r.storage_path) ?? '',
    }));
  }

  async function dailyUrls(rows: Row[]): Promise<DailyPhoto[]> {
    if (!rows.length) return [];
    const signed = await sb.storage.from(DAILY).createSignedUrls(rows.map((r) => r.storage_path), 60 * 60 * 6);
    const urls = new Map((signed.data ?? []).map((x) => [x.path, x.signedUrl]));
    return rows.map((r) => ({
      id: r.id, date: r.date, authorId: r.author_id, departmentId: r.department_id, siteId: r.site_id, internal: !!r.internal,
      width: r.width ?? 0, height: r.height ?? 0, createdAt: r.created_at, url: urls.get(r.storage_path) ?? '',
    }));
  }

  async function adminCall(body: Row) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) {
      let msg = error.message;
      try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* 기본 메시지 사용 */ }
      throw new ApiError(msg);
    }
    return data;
  }

  return {
    mode: 'supabase',

    getSession: currentMember,

    async signIn(username, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email(username), password });
      if (error) throw new ApiError('아이디 또는 비밀번호가 맞지 않습니다.');
      const m = await currentMember();
      if (!m) {
        await sb.auth.signOut();
        throw new ApiError('사용이 중지되었거나 등록되지 않은 계정입니다. 관리자에게 문의하세요.');
      }
      return m;
    },

    async signOut() { await sb.auth.signOut(); },

    async changePassword(pw) {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) throw new ApiError(error.message);
      check(await sb.rpc('password_changed'));
    },

    async loadWeek(weekId) {
      await sb.rpc('ensure_week', { p_week: weekId });
      const prev = await sb.from('weeks').select('id').lt('id', weekId).order('id', { ascending: false }).limit(1);
      const prevWeekId: string | null = prev.data?.[0]?.id ?? null;
      const weekIds = prevWeekId ? [weekId, prevWeekId] : [weekId];
      const [d, m, s, g, e, dv, ph, at, st, ss, sf] = await Promise.all([
        sb.from('departments').select('*').order('sort'),
        sb.from('members').select('*').order('name'),
        sb.from('sites').select('*').order('sort'),
        sb.from('dept_view_grants').select('*'),
        sb.from('entries').select('*').in('week_id', weekIds),
        sb.from('directives').select('*').in('week_id', weekIds),
        sb.from('photos').select('*').eq('week_id', weekId).order('created_at'),
        sb.from('attachments').select('*').eq('week_id', weekId).order('created_at'),
        sb.from('stages').select('*').order('sort'),
        sb.rpc('site_report_status', { p_week: weekId }),
        sb.from('site_fields').select('*').order('sort'),
      ]);
      const entries = (check(e) as Row[]).map(toEntry);
      const directives = (check(dv) as Row[]).map(toDirective);
      const current = entries.filter((x) => x.weekId === weekId);
      const c: Row[] = current.length
        ? check(await sb.from('comments').select('*').in('entry_id', current.map((x) => x.id)).order('created_at'))
        : [];
      const snap: Snapshot = {
        weekId,
        departments: (check(d) as Row[]).map(toDept),
        members: (check(m) as Row[]).map(toMember),
        sites: (check(s) as Row[]).map(toSite),
        stages: (check(st) as Row[]).map(toStage),
        siteFields: (check(sf) as Row[]).map((r) => ({ id: r.id, label: r.label, sort: r.sort })),
        grants: (check(g) as Row[]).map(toGrant),
        entries: current,
        directives: directives.filter((x) => x.weekId === weekId),
        comments: c.map(toComment),
        photos: await withUrls(check(ph) as Row[]),
        attachments: (check(at) as Row[]).map(toAttachment),
        siteStatus: (check(ss) as Row[]).map((r) => ({ siteId: r.site_id, departmentId: r.department_id, updatedAt: r.updated_at })),
        prevWeekId,
        prevEntries: entries.filter((x) => x.weekId === prevWeekId),
        prevDirectives: directives.filter((x) => x.weekId === prevWeekId),
      };
      return snap;
    },

    async listWeeks() {
      const rows = check(await sb.rpc('week_summaries')) as Row[];
      return rows.map((r) => ({ weekId: r.week_id, entryCount: Number(r.entry_count), writers: Number(r.writers) }));
    },

    async siteHistory(siteId) {
      const [e, d, ph] = await Promise.all([
        sb.from('entries').select('*').eq('site_id', siteId).neq('content', ''),
        sb.from('directives').select('*').eq('site_id', siteId).neq('content', ''),
        sb.from('photos').select('*').eq('site_id', siteId).order('created_at'),
      ]);
      const photos = await withUrls(check(ph) as Row[]);
      const entries = (check(e) as Row[]).map(toEntry);
      const directives = (check(d) as Row[]).map(toDirective);
      const weeks = [...new Set([...entries.map((x) => x.weekId), ...directives.map((x) => x.weekId), ...photos.map((x) => x.weekId)])].sort().reverse();
      return weeks.map((w): SiteHistoryItem => ({
        weekId: w,
        directive: directives.find((x) => x.weekId === w) ?? null,
        entries: entries.filter((x) => x.weekId === w),
        photos: photos.filter((x) => x.weekId === w),
      }));
    },

    async saveEntry(i) {
      const r = check(await sb.rpc('save_entry', {
        p_week: i.weekId, p_kind: i.kind, p_site: i.siteId, p_dept: i.departmentId, p_author: i.authorId, p_content: i.content,
      }));
      return toEntry(r as Row);
    },

    async saveDirective(i) {
      const r = check(await sb.rpc('save_directive', {
        p_week: i.weekId, p_target: i.targetKind, p_site: i.siteId, p_member: i.memberId, p_slot: i.slot, p_content: i.content,
      }));
      return toDirective(r as Row);
    },

    async addComment(entryId, content) {
      return toComment(check(await sb.rpc('add_comment', { p_entry: entryId, p_content: content })) as Row);
    },

    async acknowledgeComment(id) {
      check(await sb.rpc('acknowledge_comment', { p_comment: id }));
    },

    async deleteComment(id) {
      check(await sb.from('comments').delete().eq('id', id));
    },

    async uploadPhoto(i) {
      const path = `${i.departmentId}/${i.weekId}/${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, i.blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new ApiError('사진을 올리지 못했습니다. 이 현장 칸에 쓸 권한이 있는지 확인해 주세요.');
      const r = await sb.from('photos').insert({
        week_id: i.weekId, site_id: i.siteId, department_id: i.departmentId, storage_path: path,
        caption: i.caption, width: i.width, height: i.height,
      }).select().single();
      if (r.error) {
        await sb.storage.from(BUCKET).remove([path]);
        throw new ApiError(r.error.message);
      }
      return (await withUrls([r.data]))[0];
    },

    async deletePhoto(id) {
      const r = check(await sb.from('photos').delete().eq('id', id).select().maybeSingle());
      if (!r) throw new ApiError('올린 사람이나 관리자만 지울 수 있습니다.');
      await sb.storage.from(BUCKET).remove([r.storage_path]);
    },

    async uploadAttachment(i) {
      const bad = checkAttachable(i.file);
      if (bad) throw new ApiError(bad);
      const path = `${i.departmentId}/${i.weekId}/${crypto.randomUUID()}.${extOf(i.file.name)}`;
      const mimeType = i.file.type || 'application/octet-stream';
      const up = await sb.storage.from(FILES).upload(path, i.file, { contentType: mimeType, upsert: false });
      if (up.error) throw new ApiError('파일을 올리지 못했습니다. 이 칸에 쓸 권한이 있는지 확인해 주세요.');
      const r = await sb.from('attachments').insert({
        week_id: i.weekId, kind: i.kind, site_id: i.siteId, department_id: i.departmentId, author_id: i.authorId,
        storage_path: path, file_name: i.file.name, size_bytes: i.file.size, mime_type: mimeType,
      }).select().single();
      if (r.error) {
        await sb.storage.from(FILES).remove([path]);
        throw new ApiError(r.error.message);
      }
      return toAttachment(r.data);
    },

    async deleteAttachment(id) {
      const r = check(await sb.from('attachments').delete().eq('id', id).select().maybeSingle());
      if (!r) throw new ApiError('올린 사람이나 관리자만 지울 수 있습니다.');
      await sb.storage.from(FILES).remove([r.storage_path]);
    },

    async downloadAttachment(a) {
      const row = check(await sb.from('attachments').select('storage_path').eq('id', a.id).maybeSingle());
      if (!row) throw new ApiError('파일을 찾을 수 없습니다.');
      const { data, error } = await sb.storage.from(FILES).createSignedUrl(row.storage_path, 60, { download: a.fileName });
      if (error || !data) throw new ApiError('파일을 내려받지 못했습니다.');
      triggerDownload(data.signedUrl);
    },

    async getAiSummary(weekId) {
      const r = check(await sb.from('ai_summaries').select('*').eq('week_id', weekId).maybeSingle());
      return r ? toSummary(r) : null;
    },

    async generateAiSummary(weekId, prompt, sourceUpdatedAt) {
      const { data, error } = await sb.functions.invoke('weekly-summary', { body: { weekId, prompt, sourceUpdatedAt } });
      if (error) {
        let msg = '요약을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
        try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* 기본 메시지 사용 */ }
        throw new ApiError(msg);
      }
      const row = toSummary(data.summary);
      parseSummary(row);
      return row;
    },

    async setDirectiveStatus(id, status) {
      return toDirective(check(await sb.rpc('set_directive_status', { p_directive: id, p_status: status })) as Row);
    },

    async directiveHistory() {
      const rows = check(await sb.from('directives').select('*').in('target_kind', ['site', 'member']).neq('content', '')
        .order('week_id', { ascending: false }).limit(2000)) as Row[];
      return rows.map(toDirective);
    },

    async pendingFeedback() {
      const me = await currentMember();
      if (!me || me.isCeo || me.isExecutive) return [];
      const reviewers = check(await sb.from('members').select('id').or('is_ceo.eq.true,is_executive.eq.true')) as Row[];
      if (!reviewers.length) return [];
      const rows = check(await sb.from('comments').select('*, entry:entries!inner(*)').is('acknowledged_at', null)
        .in('author_id', reviewers.map((r) => r.id)).order('created_at', { ascending: false }).limit(200)) as Row[];
      return rows
        .map((r) => ({ comment: toComment(r), entry: toEntry(r.entry) }))
        .filter(({ entry }) => (entry.kind === 'dept' ? entry.authorId === me.id : entry.departmentId === me.departmentId));
    },

    async entryHistory(entryId) {
      const rows = check(await sb.from('entry_history').select('content, edited_by, edited_at').eq('entry_id', entryId).order('edited_at', { ascending: false }).limit(50)) as Row[];
      return rows.map((r) => ({ content: r.content, editedBy: r.edited_by, editedAt: r.edited_at }));
    },

    async getSiteSummary(siteId) {
      const r = check(await sb.from('site_summaries').select('*').eq('site_id', siteId).maybeSingle());
      return r ? toSiteSummary(r) : null;
    },

    async generateSiteSummary(siteId, months, prompt) {
      const { data, error } = await sb.functions.invoke('weekly-summary', { body: { mode: 'site', siteId, months, prompt } });
      if (error) {
        let msg = '요약을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.';
        try { msg = (await (error as any).context.json()).error ?? msg; } catch { /* 기본 메시지 사용 */ }
        throw new ApiError(msg);
      }
      return toSiteSummary(data.summary);
    },

    push: {
      available: typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
      async publicKey() {
        const { data, error } = await sb.functions.invoke('notify', { body: { action: 'public-key' } });
        if (error || !data?.publicKey) throw new ApiError('알림 설정을 불러오지 못했습니다.');
        return data.publicKey as string;
      },
      async save(sub) {
        const keys = sub.keys ?? {};
        await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint!);
        const { error } = await sb.from('push_subscriptions').insert({
          endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: navigator.userAgent.slice(0, 200),
        });
        if (error) throw new ApiError(error.code === '23505' ? '이 기기는 다른 계정으로 알림이 켜져 있습니다. 그 계정에서 먼저 알림을 꺼주세요.' : error.message);
      },
      async remove(endpoint) {
        await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
      },
      async test() {
        const { data, error } = await sb.functions.invoke('notify', { body: { action: 'test' } });
        if (error) throw new ApiError('시험 알림을 보내지 못했습니다.');
        return Number(data?.sent ?? 0);
      },
    },

    async getSettings() {
      const rows = check(await sb.from('app_settings').select('key, value').in('key', ['summary_model', 'layers_url', 'ai_enabled', 'report_notice'])) as Row[];
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      return {
        summaryModel: (get('summary_model') as string) || DEFAULT_SUMMARY_MODEL,
        layersUrl: (get('layers_url') as string) ?? '',
        ai: get('ai_enabled') as AppSettings['ai'] | undefined,
        reportNotice: get('report_notice') as string | undefined,
      };
    },

    subscribe(fn) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const debounced = () => { clearTimeout(t); t = setTimeout(fn, 400); };
      const ch = sb.channel('report-changes');
      for (const table of ['entries', 'directives', 'comments', 'sites', 'photos', 'attachments', 'stages', 'daily_reports', 'daily_photos', 'daily_comments', 'day_status', 'calendar_events', 'departments', 'members']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, debounced);
      }
      ch.subscribe();
      return () => { clearTimeout(t); sb.removeChannel(ch); };
    },

    async editComment(id, content) {
      return toComment(check(await sb.rpc('edit_comment', { p_id: id, p_content: content })));
    },

    daily: {
      async load(date) {
        const [rep, ph, cm, st] = await Promise.all([
          sb.from('daily_reports').select('*').eq('date', date),
          sb.from('daily_photos').select('*').eq('date', date).order('created_at'),
          sb.from('daily_comments').select('*').eq('date', date).order('created_at'),
          sb.from('day_status').select('*').lte('start_date', date).gte('end_date', date),
        ]);
        return {
          date,
          reports: (check(rep) as Row[]).map(toDaily),
          photos: await dailyUrls(check(ph) as Row[]),
          comments: (check(cm) as Row[]).map(toDailyComment),
          statuses: (check(st) as Row[]).map(toStatus),
        };
      },
      async save(i) {
        const r = check(await sb.rpc('save_daily', { p_date: i.date, p_site: i.siteId, p_content: i.content }));
        return r && r.id ? toDaily(r) : null;
      },
      async uploadPhoto(i) {
        const me = await currentMember();
        if (!me) throw new ApiError('로그인이 필요합니다.');
        const path = `${me.id}/${i.date}/${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from(DAILY).upload(path, i.blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw new ApiError('사진을 올리지 못했습니다.');
        const r = await sb.rpc('add_daily_photo', { p_date: i.date, p_site: i.siteId, p_path: path, p_width: i.width, p_height: i.height, p_size: i.blob.size });
        if (r.error) {
          await sb.storage.from(DAILY).remove([path]);
          throw new ApiError(r.error.message);
        }
        return (await dailyUrls([r.data]))[0];
      },
      async deletePhoto(id) {
        const path = check(await sb.rpc('delete_daily_photo', { p_id: id })) as string;
        if (path) await sb.storage.from(DAILY).remove([path]);
      },
      async addComment(date, memberId, content) {
        return toDailyComment(check(await sb.rpc('add_daily_comment', { p_date: date, p_member: memberId, p_content: content })));
      },
      async editComment(id, content) {
        return toDailyComment(check(await sb.rpc('edit_daily_comment', { p_id: id, p_content: content })));
      },
      async acknowledge(id) {
        check(await sb.rpc('ack_daily_comment', { p_id: id }));
      },
      async deleteComment(id) {
        const r = check(await sb.from('daily_comments').delete().eq('id', id).select());
        if (!(r as Row[]).length) throw new ApiError('본인이 쓴 글만 지울 수 있습니다.');
      },
      async pending() {
        const me = await currentMember();
        if (!me) return [];
        const rows = check(await sb.from('daily_comments').select('*').eq('member_id', me.id).neq('author_id', me.id)
          .is('acknowledged_at', null).order('created_at', { ascending: false }).limit(200)) as Row[];
        return rows.map(toDailyComment);
      },
      async statuses(from, to) {
        const rows = check(await sb.from('day_status').select('*').lte('start_date', to).gte('end_date', from).order('start_date')) as Row[];
        return rows.map(toStatus);
      },
      async saveStatus(x) {
        const row = { member_id: x.memberId, start_date: x.startDate, end_date: x.endDate, kind: x.kind, memo: x.memo.trim() };
        const r = isUuid(x.id)
          ? check(await sb.from('day_status').update(row).eq('id', x.id).select().single())
          : check(await sb.from('day_status').insert({ ...row, created_by: (await currentMember())?.id }).select().single());
        return toStatus(r);
      },
      async removeStatus(id) {
        const r = check(await sb.from('day_status').delete().eq('id', id).select());
        if (!(r as Row[]).length) throw new ApiError('지울 권한이 없습니다.');
      },
    },

    ask: {
      async corpus(from) {
        const page = async (q: () => any) => {
          const out: Row[] = [];
          for (let i = 0; i < 20; i++) {
            const rows = check(await q().range(i * 1000, i * 1000 + 999)) as Row[];
            out.push(...rows);
            if (rows.length < 1000) break;
          }
          return out;
        };
        const [en, dv, dl] = await Promise.all([
          page(() => sb.from('entries').select('id, week_id, kind, site_id, department_id, author_id, content').gte('week_id', from).neq('content', '').order('week_id', { ascending: false })),
          page(() => sb.from('directives').select('id, week_id, target_kind, site_id, member_id, content, status').gte('week_id', from).in('target_kind', ['site', 'member']).neq('content', '').order('week_id', { ascending: false })),
          page(() => sb.from('daily_reports').select('id, date, site_id, department_id, author_id, content').gte('date', from).eq('internal', false).neq('content', '').order('date', { ascending: false })),
        ]);
        return [
          ...en.map((e) => ({ id: e.id, kind: 'weekly' as const, date: e.week_id, siteId: e.site_id, departmentId: e.department_id, memberId: e.kind === 'dept' ? e.author_id : null, content: e.content })),
          ...dv.map((d) => ({ id: d.id, kind: 'directive' as const, date: d.week_id, siteId: d.site_id, departmentId: null, memberId: d.member_id, content: d.content, status: d.status ?? 'open' })),
          ...dl.map((r) => ({ id: r.id, kind: 'daily' as const, date: r.date, siteId: r.site_id, departmentId: r.department_id, memberId: r.author_id, content: r.content })),
        ];
      },
      async answer(prompt) {
        const { data, error } = await sb.functions.invoke('weekly-summary', { body: { mode: 'ask', prompt } });
        if (error) {
          let msg = 'AI 답변을 받지 못했습니다.';
          try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* 기본 문구 */ }
          throw new ApiError(msg);
        }
        return { answer: String(data.answer ?? ''), sourceIds: Array.isArray(data.sourceIds) ? data.sourceIds.map(String) : [], model: String(data.model ?? '') };
      },
    },

    calendar: {
      async list(from, to) {
        const rows = check(await sb.from('calendar_events').select('*').lte('start_date', to).gte('end_date', from)
          .order('start_date').order('time')) as Row[];
        return rows.map(toEvent);
      },
      async save(e) {
        if (!e.title.trim()) throw new ApiError('일정 제목을 입력해 주세요.');
        if (e.endDate < e.startDate) throw new ApiError('끝나는 날이 시작일보다 빠릅니다.');
        const row = { title: e.title.trim(), start_date: e.startDate, end_date: e.endDate, time: e.time, site_id: e.siteId, memo: e.memo.trim(), updated_at: new Date().toISOString() };
        if (isUuid(e.id)) {
          return toEvent(check(await sb.from('calendar_events').update({ ...row, scope: e.departmentId ? e.scope : 'all' }).eq('id', e.id).select().single()));
        }
        const me = await currentMember();
        if (!me) throw new ApiError('로그인이 필요합니다.');
        return toEvent(check(await sb.from('calendar_events').insert({
          ...row, scope: me.departmentId ? e.scope : 'all', department_id: me.departmentId, created_by: me.id,
        }).select().single()));
      },
      async remove(id) {
        const r = check(await sb.from('calendar_events').delete().eq('id', id).select());
        if (!(r as Row[]).length) throw new ApiError('만든 사람이나 관리자만 지울 수 있습니다.');
      },
    },

    admin: {
      async saveSite(site) {
        const row = {
          name: site.name, note: site.note, stage: site.stage, due_date: site.dueDate, due_text: site.dueText,
          process: site.process, progress: site.progress, scale: site.scale, tags: site.tags, sort: site.sort,
          archived: site.archived, completed_at: site.completedAt, extra: site.extra ?? {}, updated_at: new Date().toISOString(),
        };
        const isNew = site.id.startsWith('new_');
        const r = isNew
          ? check(await sb.from('sites').insert(row).select().single())
          : check(await sb.from('sites').update(row).eq('id', site.id).select().single());
        return toSite(r);
      },
      async deleteSite(id) {
        // 저장소 파일을 먼저 지우고 기록을 지운다 (반대로 하면 주인 없는 파일이 남는다)
        const [ph, at] = await Promise.all([
          sb.from('photos').select('storage_path').eq('site_id', id),
          sb.from('attachments').select('storage_path').eq('site_id', id),
        ]);
        for (const [bucket, rows] of [[BUCKET, check(ph) as Row[]], [FILES, check(at) as Row[]]] as const) {
          for (let i = 0; i < rows.length; i += 100) {
            const rm = await sb.storage.from(bucket).remove(rows.slice(i, i + 100).map((r) => r.storage_path));
            if (rm.error) throw new ApiError(`파일을 지우는 중 멈췄습니다: ${rm.error.message}`);
          }
        }
        check(await sb.rpc('delete_site', { p_site: id }));
      },
      async saveSiteField(f) {
        const r = await sb.from('site_fields').upsert({ id: f.id, label: f.label.trim(), sort: f.sort }).select().single();
        if (r.error) throw new ApiError(r.error.message);
        return { id: r.data.id, label: r.data.label, sort: r.data.sort };
      },
      async deleteSiteField(id) {
        check(await sb.from('site_fields').delete().eq('id', id));
      },
      async listMedia(from, before) {
        let pq = sb.from('photos').select('week_id, site_id, department_id, storage_path, created_at').lt('week_id', before);
        let aq = sb.from('attachments').select('week_id, site_id, department_id, author_id, storage_path, file_name, size_bytes').lt('week_id', before);
        if (from) { pq = pq.gte('week_id', from); aq = aq.gte('week_id', from); }
        const [ph, at] = await Promise.all([pq.order('created_at'), aq.order('created_at')]);
        const photos = check(ph) as Row[];
        const files = check(at) as Row[];
        const sign = async (bucket: string, paths: string[]) => {
          const out = new Map<string, string>();
          for (let i = 0; i < paths.length; i += 100) {
            const r = await sb.storage.from(bucket).createSignedUrls(paths.slice(i, i + 100), 60 * 60);
            (r.data ?? []).forEach((x) => { if (x.path && x.signedUrl) out.set(x.path, x.signedUrl); });
          }
          return out;
        };
        const [pu, fu] = await Promise.all([sign(BUCKET, photos.map((r) => r.storage_path)), sign(FILES, files.map((r) => r.storage_path))]);
        return [
          ...photos.map((r) => ({ kind: 'photo' as const, weekId: r.week_id, departmentId: r.department_id, siteId: r.site_id, authorId: null, fileName: '사진.jpg', sizeBytes: 0, url: pu.get(r.storage_path) ?? '' })),
          ...files.map((r) => ({ kind: 'file' as const, weekId: r.week_id, departmentId: r.department_id, siteId: r.site_id, authorId: r.author_id, fileName: r.file_name, sizeBytes: Number(r.size_bytes), url: fu.get(r.storage_path) ?? '' })),
        ].filter((x) => x.url);
      },
      async saveStage(st) {
        const row = { id: st.id, short: st.short.trim(), label: st.label.trim() || st.short.trim(), sort: st.sort };
        const r = await sb.from('stages').upsert(row).select().single();
        if (r.error) throw new ApiError(r.error.code === '23505' ? '같은 단계가 이미 있습니다.' : r.error.message);
        return toStage(r.data);
      },
      async deleteStage(id) {
        const { error } = await sb.from('stages').delete().eq('id', id);
        if (error) throw new ApiError(error.code === '23503' ? '이 단계에 현장이 있어 지울 수 없습니다. 현장을 다른 단계로 옮기거나 보관함의 현장도 확인해 주세요.' : error.message);
      },
      async saveDepartment(d) {
        const row = { name: d.name, sort: d.sort, writes_sites: d.writesSites, active: d.active, internal_report: !!d.internalReport, head_id: d.headId ?? null };
        const r = d.id.startsWith('new_')
          ? check(await sb.from('departments').insert(row).select().single())
          : check(await sb.from('departments').update(row).eq('id', d.id).select().single());
        return toDept(r);
      },
      async deleteDepartment(id) {
        const used = await sb.from('members').select('id', { count: 'exact', head: true }).eq('department_id', id);
        if ((used.count ?? 0) > 0) throw new ApiError('소속 인원이 있는 부서는 삭제할 수 없습니다. 먼저 인원을 다른 부서로 옮겨주세요.');
        const { error } = await sb.from('departments').delete().eq('id', id);
        if (error) throw new ApiError('보고 기록이 있는 부서는 삭제 대신 사용 중지로 바꿔주세요.');
      },
      async setGrants(viewer, targets) {
        check(await sb.rpc('set_grants', { p_viewer: viewer, p_targets: targets }));
        return (check(await sb.from('dept_view_grants').select('*')) as Row[]).map(toGrant);
      },
      async createMember(input) {
        const r = await adminCall({ action: 'create', ...input, username: input.username.trim().toLowerCase() });
        return toMember(r.member);
      },
      async updateMember(m) {
        const before = check(await sb.from('members').select('*').eq('id', m.id).single());
        if (before.active !== m.active) await adminCall({ action: 'set_active', memberId: m.id, active: m.active });
        const r = check(await sb.from('members').update({
          name: m.name, title: m.title, department_id: m.departmentId, is_admin: m.isAdmin, is_ceo: m.isCeo, is_executive: m.isExecutive,
          affiliation: m.affiliation ?? 'hq', home_site_id: m.affiliation === 'site' ? m.homeSiteId ?? null : null, daily_enabled: m.dailyEnabled !== false,
        }).eq('id', m.id).select().single());
        return toMember(r);
      },
      async saveSettings(next) {
        const at = new Date().toISOString();
        check(await sb.from('app_settings').upsert([
          { key: 'summary_model', value: next.summaryModel, updated_at: at },
          { key: 'layers_url', value: (next.layersUrl ?? '').trim(), updated_at: at },
          ...(next.ai ? [{ key: 'ai_enabled', value: next.ai, updated_at: at }] : []),
          ...(next.reportNotice !== undefined ? [{ key: 'report_notice', value: next.reportNotice.trim(), updated_at: at }] : []),
        ]));
        return { ...next, layersUrl: (next.layersUrl ?? '').trim() };
      },
      async storageUsage() {
        const rows = check(await sb.rpc('storage_usage')) as Row[];
        const get = (bucket: string) => rows.find((r) => r.bucket_id === bucket);
        return {
          photoCount: Number(get(BUCKET)?.objects ?? 0),
          photoBytes: Number(get(BUCKET)?.bytes ?? 0),
          fileCount: Number(get(FILES)?.objects ?? 0),
          fileBytes: Number(get(FILES)?.bytes ?? 0),
          estimated: false,
        };
      },
      async cleanupMedia(before) {
        const [ph, at] = await Promise.all([
          sb.from('photos').select('id, storage_path').lt('week_id', before),
          sb.from('attachments').select('id, storage_path, size_bytes').lt('week_id', before),
        ]);
        const photos = check(ph) as Row[];
        const files = check(at) as Row[];
        let bytes = files.reduce((n, f) => n + Number(f.size_bytes), 0);
        // 저장 공간에서 먼저 지우고 기록을 지운다 (반대로 하면 주인 없는 파일이 남는다)
        for (const [bucket, rows] of [[BUCKET, photos], [FILES, files]] as const) {
          for (let i = 0; i < rows.length; i += 100) {
            const chunk = rows.slice(i, i + 100);
            const rm = await sb.storage.from(bucket).remove(chunk.map((r) => r.storage_path));
            if (rm.error) throw new ApiError(`파일을 지우는 중 멈췄습니다: ${rm.error.message}`);
            if (bucket === BUCKET) bytes += (rm.data ?? []).reduce((n, o: Row) => n + Number(o.metadata?.size ?? 0), 0);
            check(await sb.from(bucket === BUCKET ? 'photos' : 'attachments').delete().in('id', chunk.map((r) => r.id)));
          }
        }
        return { photos: photos.length, files: files.length, bytes };
      },
      async listBackups() {
        const rows = check(await sb.from('backups').select('id, created_at, kind, size_bytes').order('created_at', { ascending: false })) as Row[];
        return rows.map((r) => ({ id: Number(r.id), createdAt: r.created_at, kind: r.kind, sizeBytes: Number(r.size_bytes) }));
      },
      async createBackup() {
        check(await sb.rpc('create_backup'));
      },
      async downloadBackup(b) {
        const r = check(await sb.from('backups').select('data').eq('id', b.id).single());
        const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' }));
        triggerDownload(url, `sadakdari-backup-${b.createdAt.slice(0, 10)}.json`);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
      async pushMembers() {
        const rows = check(await sb.from('push_subscriptions').select('member_id')) as Row[];
        return [...new Set(rows.map((r) => r.member_id as string))];
      },
      async changeUsername(memberId, username) {
        const r = await adminCall({ action: 'set_username', memberId, username: username.trim().toLowerCase() });
        return toMember(r.member);
      },
      async resetPassword(memberId, password) {
        await adminCall({ action: 'reset_password', memberId, password });
      },
    },
  };
}
