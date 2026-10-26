import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError, type Api, type SiteHistoryItem } from './api';
import { parseSummary } from './summary';
import type { AiSummary, Comment, Department, Directive, Entry, Grant, Member, Photo, Site, Snapshot } from './types';

const BUCKET = 'site-photos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const toDept = (r: Row): Department => ({ id: r.id, name: r.name, sort: r.sort, writesSites: r.writes_sites, active: r.active });
const toMember = (r: Row): Member => ({
  id: r.id, username: r.username, name: r.name, title: r.title, departmentId: r.department_id,
  isCeo: r.is_ceo, isAdmin: r.is_admin, active: r.active, mustChangePassword: r.must_change_password,
});
const toSite = (r: Row): Site => ({
  id: r.id, name: r.name, note: r.note, stage: r.stage, dueDate: r.due_date, dueText: r.due_text, process: r.process,
  progress: r.progress == null ? null : Number(r.progress), scale: r.scale, tags: r.tags ?? [], sort: r.sort,
  archived: r.archived, completedAt: r.completed_at,
});
const toGrant = (r: Row): Grant => ({ viewerDepartmentId: r.viewer_department_id, targetDepartmentId: r.target_department_id });
const toEntry = (r: Row): Entry => ({
  id: r.id, weekId: r.week_id, kind: r.kind, siteId: r.site_id, departmentId: r.department_id, authorId: r.author_id,
  content: r.content, updatedAt: r.updated_at, updatedBy: r.updated_by,
});
const toDirective = (r: Row): Directive => ({
  id: r.id, weekId: r.week_id, targetKind: r.target_kind, siteId: r.site_id, memberId: r.member_id, slot: r.slot,
  content: r.content, updatedAt: r.updated_at,
});
const toComment = (r: Row): Comment => ({
  id: r.id, entryId: r.entry_id, authorId: r.author_id, content: r.content, createdAt: r.created_at,
  acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
});

const toSummary = (r: Row): AiSummary => ({
  weekId: r.week_id, highlights: r.highlights ?? [], siteChanges: r.site_changes ?? [],
  generatedAt: r.generated_at, sourceUpdatedAt: r.source_updated_at ?? '',
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
      const [d, m, s, g, e, dv, ph] = await Promise.all([
        sb.from('departments').select('*').order('sort'),
        sb.from('members').select('*').order('name'),
        sb.from('sites').select('*').order('sort'),
        sb.from('dept_view_grants').select('*'),
        sb.from('entries').select('*').in('week_id', weekIds),
        sb.from('directives').select('*').in('week_id', weekIds),
        sb.from('photos').select('*').eq('week_id', weekId).order('created_at'),
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
        grants: (check(g) as Row[]).map(toGrant),
        entries: current,
        directives: directives.filter((x) => x.weekId === weekId),
        comments: c.map(toComment),
        photos: await withUrls(check(ph) as Row[]),
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

    subscribe(fn) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const debounced = () => { clearTimeout(t); t = setTimeout(fn, 400); };
      const ch = sb.channel('report-changes');
      for (const table of ['entries', 'directives', 'comments', 'sites', 'photos']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, debounced);
      }
      ch.subscribe();
      return () => { clearTimeout(t); sb.removeChannel(ch); };
    },

    admin: {
      async saveSite(site) {
        const row = {
          name: site.name, note: site.note, stage: site.stage, due_date: site.dueDate, due_text: site.dueText,
          process: site.process, progress: site.progress, scale: site.scale, tags: site.tags, sort: site.sort,
          archived: site.archived, completed_at: site.completedAt, updated_at: new Date().toISOString(),
        };
        const isNew = site.id.startsWith('new_');
        const r = isNew
          ? check(await sb.from('sites').insert(row).select().single())
          : check(await sb.from('sites').update(row).eq('id', site.id).select().single());
        return toSite(r);
      },
      async saveDepartment(d) {
        const row = { name: d.name, sort: d.sort, writes_sites: d.writesSites, active: d.active };
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
          name: m.name, title: m.title, department_id: m.departmentId, is_admin: m.isAdmin, is_ceo: m.isCeo,
        }).eq('id', m.id).select().single());
        return toMember(r);
      },
      async resetPassword(memberId, password) {
        await adminCall({ action: 'reset_password', memberId, password });
      },
    },
  };
}
