import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './api';
import { shrinkImage } from './image';
import { pdfText } from './pdfPages';
import { ruleText, safetyHits, stripMarks } from './safetyRules';
import {
  DEFAULT_TALK_SETTINGS, type ChatAttachment, type ChatMessage, type ChatRoom, type Inquiry, type Notice, type RoomSummary, type SafetyTip,
  type SiteDoc, type TalkApi, type TalkSettings,
} from './talkTypes';
import type { Member, SearchDoc, Site } from './types';
import { currentWeekId, shiftDay } from './week';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const FILES = 'talk-files';
const URL_TTL = 60 * 60 * 6;
const isUuid = (s: string | null | undefined) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function check(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new ApiError(res.error.message);
  return res.data;
}

const toRoom = (r: Row, memberIds: string[] = [], mutedBy: string[] = []): ChatRoom => ({
  id: r.id, kind: r.kind, name: r.name ?? '', siteId: r.site_id ?? null, memberIds, pinned: r.pinned ?? '', pinnedBy: r.pinned_by ?? null,
  pinnedAt: r.pinned_at ?? null, mutedBy, meetingDow: r.meeting_dow ?? null, sort: r.sort ?? 100, createdAt: r.created_at,
});

const toMessage = (r: Row, urls: Map<string, string> = new Map()): ChatMessage => ({
  id: r.id, roomId: r.room_id, authorId: r.author_id, text: r.text ?? '',
  attachments: ((r.attachments ?? []) as Row[]).map((a): ChatAttachment => ({
    id: a.id ?? a.path, name: a.name, kind: a.kind === 'image' ? 'image' : 'file', url: urls.get(a.path) ?? '', path: a.path, size: Number(a.size ?? 0), width: a.width, height: a.height,
  })),
  replyToId: r.reply_to ?? null, mentions: r.mentions ?? [], createdAt: r.created_at, editedAt: r.edited_at ?? null, deleted: !!r.deleted,
  inquiryId: r.inquiry_id ?? null, directive: r.directive ?? null, safety: !!r.safety, system: !!r.system,
  hidden: r.hidden_at ? { by: r.hidden_by, at: r.hidden_at } : null, docCategory: r.doc_category ?? null,
});

const toInquiry = (r: Row): Inquiry => ({
  id: r.id, church: r.church, region: r.region, contactName: r.contact_name, phone: r.phone, scale: r.scale, budget: r.budget, timing: r.timing,
  source: r.source, stage: r.stage, ownerId: r.owner_id ?? null, note: r.note, createdBy: r.created_by ?? '', createdAt: r.created_at,
  updatedAt: r.updated_at, lastActivityAt: r.last_activity_at, siteId: r.site_id ?? null,
});

const toDoc = (r: Row, urls: Map<string, string>): SiteDoc => ({
  id: r.id, siteId: r.site_id, category: r.category, docDate: r.doc_date, title: r.title, note: r.note, fileName: r.file_name, fileType: r.file_type,
  url: urls.get(r.storage_path) ?? '', size: Number(r.size ?? 0), text: r.text ?? '', uploadedBy: r.uploaded_by ?? '', createdAt: r.created_at, messageId: r.message_id ?? null,
});

const toSite = (r: Row): Site => ({
  id: r.id, name: r.name, note: r.note, stage: r.stage, dueDate: r.due_date, dueText: r.due_text, process: r.process,
  progress: r.progress == null ? null : Number(r.progress), scale: r.scale, tags: r.tags ?? [], sort: r.sort, archived: r.archived, completedAt: r.completed_at, extra: r.extra ?? {},
});

const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? 'bin').toLowerCase();
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function createSupabaseTalk(sb: SupabaseClient, currentMember: () => Promise<Member | null>): TalkApi {
  async function me(): Promise<Member> {
    const m = await currentMember();
    if (!m) throw new ApiError('로그인이 필요합니다.');
    return m;
  }

  async function sign(paths: string[]): Promise<Map<string, string>> {
    const list = [...new Set(paths.filter(Boolean))];
    const out = new Map<string, string>();
    for (let i = 0; i < list.length; i += 500) {
      const res = await sb.storage.from(FILES).createSignedUrls(list.slice(i, i + 500), URL_TTL);
      (res.data ?? []).forEach((x) => { if (x.path && x.signedUrl) out.set(x.path, x.signedUrl); });
    }
    return out;
  }

  /** 파일 올리기: 사진은 줄여서, 나머지는 그대로 */
  async function put(folder: string, f: File): Promise<{ path: string; size: number; kind: 'image' | 'file'; width?: number; height?: number }> {
    const image = f.type.startsWith('image/') && !/gif|svg/.test(f.type);
    if (image) {
      const s = await shrinkImage(f, 1800, 0.82);
      const path = `${folder}/${crypto.randomUUID()}.jpg`;
      check(await sb.storage.from(FILES).upload(path, s.blob, { contentType: 'image/jpeg' }));
      return { path, size: s.blob.size, kind: 'image', width: s.width, height: s.height };
    }
    if (f.size > 25 * 1024 * 1024) throw new ApiError(`'${f.name}'은(는) 25MB가 넘어 올릴 수 없습니다.`);
    const path = `${folder}/${crypto.randomUUID()}.${extOf(f.name)}`;
    check(await sb.storage.from(FILES).upload(path, f, { contentType: f.type || 'application/octet-stream' }));
    return { path, size: f.size, kind: 'file' };
  }

  async function settings(): Promise<TalkSettings> {
    const r = check(await sb.from('app_settings').select('value').eq('key', 'talk').maybeSingle()) as Row | null;
    return { ...structuredClone(DEFAULT_TALK_SETTINGS), ...((r?.value as Partial<TalkSettings>) ?? {}) };
  }

  /** PDF에 글자가 없으면(스캔본·사진) AI가 읽어 글자를 채운다 (AI가 꺼져 있으면 서버가 거절) */
  function ocr(docId: string) {
    void sb.functions.invoke('weekly-summary', { body: { mode: 'ocr', docId } }).catch(() => undefined);
  }

  return {
    async load() {
      await me();
      const [rooms, notices, reads, inquiries, docs, s] = await Promise.all([
        sb.rpc('talk_rooms'),
        sb.from('notices').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200),
        sb.from('notice_reads').select('*'),
        sb.from('inquiries').select('*').order('last_activity_at', { ascending: false }).limit(500),
        sb.from('site_docs').select('id, site_id, category, doc_date, title, note, file_name, file_type, storage_path, size, uploaded_by, created_at, message_id')
          .order('doc_date', { ascending: false }).order('created_at', { ascending: false }).limit(800),
        settings(),
      ]);
      const roomRows = (check(rooms) ?? []) as Row[];
      const lastPaths = roomRows.flatMap((x) => ((x.last?.attachments ?? []) as Row[]).map((a) => a.path));
      const docRows = check(docs) as Row[];
      const urls = await sign([...lastPaths, ...docRows.map((d) => d.storage_path)]);
      const readRows = check(reads) as Row[];
      return {
        rooms: roomRows.map((x): RoomSummary => ({
          room: toRoom(x.room, x.memberIds ?? [], x.mutedBy ?? []),
          last: x.last ? toMessage(x.last, urls) : null,
          unread: Number(x.unread ?? 0),
          reads: x.reads ?? {},
          starred: !!x.starred,
        })),
        notices: (check(notices) as Row[]).map((n): Notice => {
          const rs = readRows.filter((r) => r.notice_id === n.id);
          return {
            id: n.id, title: n.title, body: n.body, authorId: n.author_id, createdAt: n.created_at, updatedAt: n.updated_at, requireAck: n.require_ack, pinned: n.pinned, urgent: !!n.urgent,
            reads: Object.fromEntries(rs.filter((r) => r.read_at).map((r) => [r.member_id, r.read_at])),
            acks: Object.fromEntries(rs.filter((r) => r.ack_at).map((r) => [r.member_id, r.ack_at])),
          };
        }),
        inquiries: (check(inquiries) as Row[]).map(toInquiry),
        docs: docRows.map((d) => toDoc(d, urls)),
        settings: s,
      };
    },

    subscribe(fn) {
      let t: ReturnType<typeof setTimeout> | undefined;
      const debounced = () => { clearTimeout(t); t = setTimeout(fn, 400); };
      const ch = sb.channel(`talk-${Math.random().toString(36).slice(2)}`);
      for (const table of ['chat_messages', 'chat_rooms', 'chat_room_members', 'notices', 'notice_reads', 'inquiries', 'site_docs']) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table }, debounced);
      }
      let first = true;
      ch.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (first) { first = false; return; }
        debounced();
      });
      const onVisible = () => { if (document.visibilityState === 'visible') debounced(); };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', debounced);
      return () => {
        clearTimeout(t);
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', debounced);
        void sb.removeChannel(ch);
      };
    },

    async messages(roomId) {
      const m = await me();
      const rows = (check(await sb.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: false }).limit(400)) as Row[]).reverse();
      // 관리자는 가린 메시지 본문도 본다 (흐리게 표시)
      if (m.isAdmin) {
        const hiddenIds = rows.filter((r) => r.hidden_at).map((r) => r.id);
        if (hiddenIds.length) {
          const h = check(await sb.from('chat_hidden').select('*').in('message_id', hiddenIds)) as Row[];
          const byId = new Map(h.map((x) => [x.message_id, x]));
          rows.forEach((r) => { const x = byId.get(r.id); if (x) { r.text = x.text; r.attachments = x.attachments; } });
        }
      }
      const urls = await sign(rows.flatMap((r) => ((r.attachments ?? []) as Row[]).map((a) => a.path)));
      return rows.map((r) => toMessage(r, urls));
    },

    async send({ roomId, text, files = [], replyToId = null, inquiryId = null, docCategory = null }) {
      const room = check(await sb.from('chat_rooms').select('id, site_id').eq('id', roomId).maybeSingle()) as Row | null;
      if (!room) throw new ApiError('이 방에 들어가 있지 않습니다.');
      const attachments: Row[] = [];
      const docs: Row[] = [];
      for (const f of files) {
        const up = await put(`room/${roomId}`, f);
        attachments.push({ id: up.path, name: f.name, kind: up.kind, path: up.path, size: up.size, width: up.width, height: up.height });
        if (docCategory && room.site_id) {
          docs.push({ name: f.name, title: f.name.replace(/\.[^.]+$/, ''), fileType: up.kind === 'image' ? 'image' : isPdf(f) ? 'pdf' : 'file', path: up.path, size: up.size,
            text: isPdf(f) ? await pdfText(URL.createObjectURL(f)).catch(() => '') : '' });
        }
      }
      const msg = check(await sb.rpc('send_message', {
        p_room: roomId, p_text: text, p_attachments: attachments, p_reply: isUuid(replyToId) ? replyToId : null, p_inquiry: isUuid(inquiryId) ? inquiryId : null,
        p_doc_category: docs.length ? docCategory : null, p_docs: docs,
      })) as Row;
      // 글자 없는 PDF·사진 자료는 AI가 읽어 둔다
      if (docs.some((d) => !String(d.text).trim())) {
        const saved = check(await sb.from('site_docs').select('id, text').eq('message_id', msg.id)) as Row[];
        saved.filter((d) => !String(d.text ?? '').trim()).forEach((d) => ocr(d.id));
      }
      return toMessage(msg, await sign(attachments.map((a) => a.path)));
    },

    /** 내가 들어간 방 전체에서 글 찾기 (읽기 권한이 방 인원으로 막혀 있어 내 방만 나온다) */
    async searchMessages(q) {
      await me();
      const t = q.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
      if (!t) return [];
      const rows = check(await sb.from('chat_messages').select('*').ilike('text', `%${t}%`).eq('deleted', false).is('hidden_at', null)
        .order('created_at', { ascending: false }).limit(60)) as Row[];
      const urls = await sign(rows.flatMap((r) => ((r.attachments ?? []) as Row[]).map((a) => a.path)));
      return rows.map((r) => toMessage(r, urls));
    },
    async note(roomId, text, replyToId = null) { check(await sb.rpc('post_note', { p_room: roomId, p_text: text, p_reply: isUuid(replyToId) ? replyToId : null })); },
    async setStarred(roomId, starred) { check(await sb.rpc('set_room_starred', { p_room: roomId, p_starred: starred })); },

    async editMessage(id, text) { return toMessage(check(await sb.rpc('edit_message', { p_id: id, p_text: text }))); },
    async deleteMessage(id) { check(await sb.rpc('delete_message', { p_id: id })); },
    async hideMessage(id, hidden) { check(await sb.rpc('hide_message', { p_id: id, p_hidden: hidden })); },
    async markRead(roomId) { check(await sb.rpc('mark_room_read', { p_room: roomId })); },
    async setMuted(roomId, muted) { check(await sb.rpc('set_room_muted', { p_room: roomId, p_muted: muted })); },
    async pin(roomId, text) { check(await sb.rpc('pin_room', { p_room: roomId, p_text: text })); },
    async openDm(memberId) {
      const m = await me();
      return toRoom(check(await sb.rpc('open_dm', { p_other: memberId })), [m.id, memberId]);
    },
    async toDirective({ messageId, text, memberIds, siteId }) {
      check(await sb.rpc('message_to_directive', { p_message: messageId, p_text: text, p_members: memberIds, p_site: siteId, p_week: currentWeekId() }));
    },

    notices: {
      async save(n) {
        const r = check(await sb.rpc('save_notice', { p_id: isUuid(n.id) ? n.id : null, p_title: n.title, p_body: n.body, p_require_ack: n.requireAck, p_pinned: n.pinned, p_urgent: !!n.urgent })) as Row;
        return { id: r.id, title: r.title, body: r.body, authorId: r.author_id, createdAt: r.created_at, updatedAt: r.updated_at, requireAck: r.require_ack, pinned: r.pinned, urgent: !!r.urgent, reads: {}, acks: {} };
      },
      async remove(id) { check(await sb.rpc('delete_notice', { p_id: id })); },
      async read(id) { check(await sb.rpc('notice_read', { p_id: id })); },
      async ack(id) { check(await sb.rpc('notice_ack', { p_id: id })); },
      async remind(id) { return Number(check(await sb.rpc('notice_remind', { p_id: id }))); },
      async announceVideo(title, videoId) { check(await sb.rpc('announce_video', { p_title: title, p_video_id: videoId })); },
    },

    inquiries: {
      async save(i) {
        return toInquiry(check(await sb.rpc('save_inquiry', { p: {
          id: isUuid(i.id) ? i.id : null, church: i.church, region: i.region, contactName: i.contactName, phone: i.phone, scale: i.scale, budget: i.budget,
          timing: i.timing, source: i.source, stage: i.stage, ownerId: i.ownerId, note: i.note,
        } })));
      },
      async remove(id) { check(await sb.rpc('delete_inquiry', { p_id: id })); },
      async toSite(id) { return toSite(check(await sb.rpc('inquiry_to_site', { p_id: id }))); },
    },

    docs: {
      async upload({ siteId, category, docDate, title, note, file }) {
        const up = await put(`site/${siteId}`, file);
        const pdf = isPdf(file);
        const text = pdf ? await pdfText(URL.createObjectURL(file)).catch(() => '') : '';
        const r = check(await sb.rpc('add_site_doc', {
          p_site: siteId, p_category: category, p_date: docDate, p_title: title, p_note: note, p_file_name: file.name,
          p_file_type: up.kind === 'image' ? 'image' : pdf ? 'pdf' : 'file', p_path: up.path, p_size: up.size, p_text: text,
        })) as Row;
        if (!text.trim() && (pdf || up.kind === 'image')) ocr(r.id);
        return toDoc(r, await sign([up.path]));
      },
      async remove(id) {
        const path = check(await sb.rpc('delete_site_doc', { p_id: id })) as string | null;
        if (path) await sb.storage.from(FILES).remove([path]);
      },
      async requestMinutes(siteId) { check(await sb.rpc('request_minutes', { p_site: siteId })); },
      async search(q) {
        // PostgREST 조건식에 쓰이는 글자는 뺀다
        const t = q.trim().replace(/[,()%*\\]/g, ' ').trim();
        if (!t) return [];
        const p = `%${t}%`;
        const rows = check(await sb.from('site_docs').select('id')
          .or(`title.ilike.${p},note.ilike.${p},file_name.ilike.${p},text.ilike.${p}`).limit(500)) as Row[];
        return rows.map((r) => r.id as string);
      },
      async corpus(from) {
        const m = await me();
        if (!m.isCeo) return [];
        const rows = check(await sb.from('site_docs').select('id, site_id, category, doc_date, title, note, text, uploaded_by').gte('doc_date', from).neq('text', '').limit(1000)) as Row[];
        return rows.map((d): SearchDoc => ({
          id: d.id, kind: 'doc', date: d.doc_date, siteId: d.site_id, departmentId: null, memberId: d.uploaded_by,
          content: `${d.title}\n${d.note}\n${d.text}`.trim(), docCategory: d.category, docTitle: d.title,
        }));
      },
    },

    safety: {
      async suggestions(date, refresh = false) {
        const m = await me();
        if (!m.isCeo) return [];
        const [rooms, existing] = await Promise.all([
          sb.from('chat_rooms').select('id, kind, site_id'),
          sb.from('safety_tips').select('*').eq('date', date),
        ]);
        const myRooms = check(rooms) as Row[];
        let tips = check(existing) as Row[];
        const roomsFor = (siteId: string) => myRooms.filter((r) => r.kind === 'safety' || (r.kind === 'site' && r.site_id === siteId)).map((r) => r.id as string);
        if (refresh) {
          await sb.from('safety_tips').delete().eq('date', date).eq('status', 'new');
          tips = tips.filter((t) => t.status !== 'new');
        }
        if (!tips.length || refresh) {
          // 어제·오늘 현장 일일보고 + 앞으로 3일 현장 일정에서 위험 작업 찾기
          const [rep, ev, sites, members] = await Promise.all([
            sb.from('daily_reports').select('site_id, author_id, content').gte('date', shiftDay(date, -1)).lte('date', date).not('site_id', 'is', null).neq('content', ''),
            sb.from('calendar_events').select('site_id, title, start_date').gte('start_date', date).lte('start_date', shiftDay(date, 3)).not('site_id', 'is', null),
            sb.from('sites').select('id, name').eq('archived', false),
            sb.from('members').select('id, name'),
          ]);
          const names = new Map((check(members) as Row[]).map((x) => [x.id, x.name]));
          const done = new Set(tips.map((t) => t.site_id));
          const found: { site: Row; lines: string[]; hits: ReturnType<typeof safetyHits> }[] = [];
          for (const site of check(sites) as Row[]) {
            if (done.has(site.id)) continue;
            const lines = [
              ...(check(rep) as Row[]).filter((r) => r.site_id === site.id).flatMap((r) => stripMarks(r.content).split(/ ?[-■•] /).map((l) => l.trim()).filter(Boolean).map((l) => `일일보고 (${names.get(r.author_id) ?? ''}): ${l}`)),
              ...(check(ev) as Row[]).filter((e) => e.site_id === site.id).map((e) => `일정 ${String(e.start_date).slice(5).replace('-', '/')}: ${e.title}`),
            ];
            const hits = safetyHits(lines);
            if (hits.length) found.push({ site, lines, hits });
          }
          if (found.length) {
            // AI가 켜져 있으면 현장 상황에 맞게 짧게 쓰고, 아니면 기본 문구
            let aiText = new Map<string, string>();
            try {
              const prompt = [
                '너는 종합건설회사 대표의 안전 당부 메시지를 대신 쓰는 사람이다. 아래 현장별 보고·일정을 보고, 현장 직원과 안전 담당에게 보낼 짧은 당부를 현장마다 하나씩 써라.',
                '- 3~5줄, 존댓말, 실제 작업 이름과 날짜를 넣고 구체적인 조치만 쓴다. 과장·겁주기 금지. 첫 줄은 [현장이름 안전 당부].',
                '- 보고에 없는 사실은 지어내지 않는다.',
                '',
                ...found.map((f) => `### siteId=${f.site.id} · ${f.site.name}\n${f.lines.slice(0, 12).join('\n')}\n(찾은 위험 작업: ${f.hits.map((h) => h.rule.label).join(', ')})`),
              ].join('\n');
              const { data } = await sb.functions.invoke('weekly-summary', { body: { mode: 'safety', prompt } });
              aiText = new Map(((data?.tips ?? []) as Row[]).map((t) => [String(t.siteId), String(t.text)]));
            } catch { /* AI를 못 쓰면 기본 문구 */ }
            const rows = found.map((f) => ({
              id: `${date}|${f.site.id}`, date, site_id: f.site.id, sources: [...new Set(f.hits.flatMap((h) => h.src))].slice(0, 5),
              text: aiText.get(f.site.id)?.trim() || ruleText(f.site.name, f.hits), room_ids: roomsFor(f.site.id), status: 'new',
            }));
            check(await sb.from('safety_tips').upsert(rows));
            tips = [...tips, ...rows];
          }
        }
        return tips.map((t): SafetyTip => ({ id: t.id, date: t.date, siteId: t.site_id, sources: t.sources ?? [], text: t.text, roomIds: roomsFor(t.site_id), status: t.status }));
      },
      async send(tip, text, roomIds) { check(await sb.rpc('send_safety', { p_rooms: roomIds, p_text: text, p_tip: tip.id })); },
      async dismiss(tip) { check(await sb.from('safety_tips').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', tip.id)); },
    },

    admin: {
      async rooms() {
        const [rooms, mem] = await Promise.all([
          sb.from('chat_rooms').select('*').neq('kind', 'dm').order('sort').order('created_at'),
          sb.from('chat_room_members').select('room_id, member_id, muted'),
        ]);
        const ms = check(mem) as Row[];
        return (check(rooms) as Row[]).map((r) => toRoom(r, ms.filter((x) => x.room_id === r.id).map((x) => x.member_id), ms.filter((x) => x.room_id === r.id && x.muted).map((x) => x.member_id)));
      },
      async saveRoom(r) {
        const row = check(await sb.rpc('admin_save_room', { p_id: isUuid(r.id) ? r.id : null, p_name: r.name, p_site: r.siteId, p_meeting_dow: r.meetingDow, p_members: r.memberIds })) as Row;
        return toRoom(row, r.memberIds);
      },
      async deleteRoom(id) { check(await sb.rpc('admin_delete_room', { p_id: id })); },
      async saveSettings(s) {
        check(await sb.from('app_settings').upsert({ key: 'talk', value: s, updated_at: new Date().toISOString() }));
        return s;
      },
    },
  };
}
