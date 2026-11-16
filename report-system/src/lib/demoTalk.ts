import { ApiError, newId } from './api';
import { blobToDataUrl, shrinkImage } from './image';
import { pdfText } from './pdfPages';
import {
  DEFAULT_TALK_SETTINGS, INQUIRY_STAGES, MINUTES, isBuiltinRoom, type ChatAttachment, type ChatMessage, type ChatRoom, type Inquiry, type Notice,
  type RoomSummary, type SafetyTip, type SiteDoc, type TalkApi, type TalkSettings,
} from './talkTypes';
import type { CalendarEvent, DailyReport, Department, Member, SearchDoc, Site, StageDef } from './types';
import sampleText from './demoDocText.json';
import { shiftDay } from './week';

/** 체험판 소통(공지·채팅) 서버. 보고 데이터와 따로 브라우저에 저장한다 */

export interface DemoTalkCtx {
  me(): Member;
  members(): Member[];
  departments(): Department[];
  sites(): Site[];
  stages(): StageDef[];
  daily(): DailyReport[];
  events(): CalendarEvent[];
  today(): string;
  /** 대표님 지시 칸 끝에 한 줄 덧붙인다 (이번 주) */
  appendDirective(target: { memberId: string } | { siteId: string }, line: string): void;
  createSite(s: Site): void;
  emit(): void;
}

interface TalkState {
  v: 2;
  rooms: ChatRoom[];
  messages: ChatMessage[];
  /** roomId → memberId → 마지막으로 읽은 때 */
  reads: Record<string, Record<string, string>>;
  notices: Notice[];
  inquiries: Inquiry[];
  docs: SiteDoc[];
  /** `${date}|${siteId}` → 처리 상태 */
  tips: Record<string, 'sent' | 'dismissed'>;
  settings: TalkSettings;
}

const KEY = 'sadakdari-report-demo-talk-v1';
const MB = 1024 * 1024;
const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 40));

/* ───────── 위험 작업 → 주의 문구 (체험판 예시 규칙. 실제는 AI가 보고를 읽고 문장을 만든다) ───────── */
const RULES: { re: RegExp; label: string; tip: string }[] = [
  { re: /타설|레미콘|펌프카/, label: '콘크리트 타설', tip: '펌프카 아웃트리거 받침과 지반 확인, 타설 중 거푸집·동바리 변형 감시, 신호수 배치' },
  { re: /거푸집|동바리/, label: '거푸집·동바리', tip: '설치 상태와 동바리 간격·수직도를 타설 전에 다시 확인' },
  { re: /비계|난간|고소|개구부/, label: '고소 작업', tip: '작업 전 난간·발판 고정 확인, 안전대 걸이 사용, 개구부 덮개 점검' },
  { re: /크레인|양중|인양/, label: '양중 작업', tip: '신호수 지정, 작업 반경 출입 통제, 줄걸이·슬링 점검' },
  { re: /반입|하역|철근 \d+톤|자재/, label: '자재 반입', tip: '하역 구간 출입 통제, 장비와 사람 동선 분리' },
  { re: /용접|절단|화기|단열재/, label: '화기·단열재', tip: '단열재 주변 화기작업 금지, 화재감시자 배치와 소화기 비치' },
  { re: /굴착|흙막이|터파기/, label: '굴착', tip: '흙막이 변위 확인, 굴착면 접근 통제, 장비 후진 경보' },
  { re: /비 예보|강풍|우천|폭우/, label: '기상 악화', tip: '외부·고소 작업 중지 기준 공유, 가설 전기 누전 점검' },
  { re: /신규 근로자|신규자/, label: '신규 근로자', tip: '신규 근로자 작업 전 교육과 숙련자 짝 배치' },
];

function strip(s: string) {
  return s.replace(/\[\/?(b|red|blue|hl)\]/g, '').replace(/\s+/g, ' ').trim();
}

export function createDemoTalk(ctx: DemoTalkCtx): TalkApi {
  let st: TalkState = load();
  const channel = (() => { try { return new BroadcastChannel(KEY); } catch { return null; } })();
  if (channel) channel.onmessage = () => { st = load(); ctx.emit(); };

  function load(): TalkState {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw) as TalkState; if (s.v === 2) { s.settings = { ...structuredClone(DEFAULT_TALK_SETTINGS), ...s.settings }; return s; } }
    } catch { /* 처음부터 */ }
    return fresh();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { throw new ApiError('체험판 저장 공간이 가득 찼습니다. 큰 파일을 지우거나 체험판을 초기화하세요.'); }
    channel?.postMessage('changed');
  }

  /* ───────── 견본 ───────── */
  function fresh(): TalkState {
    const ms = ctx.members().filter((m) => m.active);
    const depts = ctx.departments();
    const deptOf = (re: RegExp) => depts.filter((d) => re.test(d.name)).map((d) => d.id);
    const inDept = (ids: string[]) => ms.filter((m) => m.departmentId && ids.includes(m.departmentId)).map((m) => m.id);
    const ceo = ms.find((m) => m.isCeo)?.id;
    const admin = ms.find((m) => m.isAdmin && !m.isCeo)?.id;
    const top = [ceo, admin].filter(Boolean) as string[];
    const build = inDept(deptOf(/공무|견적|안전|CM/));
    const design = inDept(deptOf(/디자인/));
    const safety = inDept(deptOf(/안전/));
    const siteStaff = ms.filter((m) => m.affiliation === 'site');
    const sites = ctx.sites().filter((s) => !s.archived);
    const now = Date.now();
    const ago = (min: number) => new Date(now - min * 60000).toISOString();
    const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];
    const room = (p: Partial<ChatRoom> & Pick<ChatRoom, 'id' | 'kind' | 'name' | 'memberIds'>, sort: number): ChatRoom => ({
      siteId: null, pinned: '', pinnedBy: null, pinnedAt: null, mutedBy: [], meetingDow: null, createdAt: ago(60 * 24 * 30), sort, ...p, memberIds: uniq(p.memberIds),
    });
    const rooms: ChatRoom[] = [
      room({ id: 'room_build', kind: 'group', name: '건설사업부', memberIds: [...top, ...build] }, 1),
      room({ id: 'room_design', kind: 'group', name: '디자인실', memberIds: [...top, ...design] }, 2),
      room({ id: 'room_dev', kind: 'group', name: '시행사업부', memberIds: [...top, ...inDept(deptOf(/CM/))] }, 3),
      room({ id: 'room_chief', kind: 'group', name: '소장방', memberIds: [ceo, ...build.slice(0, 1), ...safety, ...siteStaff.filter((m) => /소장/.test(m.title)).map((m) => m.id)] as string[], pinned: '매주 금요일 17시까지 다음 주 주요 작업 공유', pinnedBy: ceo ?? null, pinnedAt: ago(60 * 24 * 3) }, 4),
      room({ id: 'room_safety', kind: 'safety', name: '안전방', memberIds: [ceo, ...safety, ...siteStaff.map((m) => m.id)] as string[] }, 5),
      ...sites.slice(0, 2).map((s, i) => room({
        id: `room_site_${s.id}`, kind: 'site', name: s.name, siteId: s.id, meetingDow: 3,
        memberIds: [ceo, ...build.slice(0, 1), ...safety, ...siteStaff.filter((m) => m.homeSiteId === s.id).map((m) => m.id)] as string[],
      }, 10 + i)),
      room({ id: 'room_inquiry', kind: 'inquiry', name: '신규 교회건축 문의', memberIds: [...top, ...inDept(deptOf(/CM|견적/))] }, 20),
    ];
    const say = (roomId: string, authorId: string | undefined, text: string, min: number, extra: Partial<ChatMessage> = {}): ChatMessage | null => (authorId ? {
      id: newId('msg'), roomId, authorId, text, attachments: [], replyToId: null, mentions: [], createdAt: ago(min), editedAt: null, deleted: false,
      inquiryId: null, directive: null, safety: false, system: false, hidden: null, docCategory: null, ...extra,
    } : null);
    const s1 = sites[0]; const s2 = sites[1];
    const r1 = rooms.find((r) => r.siteId === s1?.id); const r2 = rooms.find((r) => r.siteId === s2?.id);
    const chief = siteStaff.find((m) => m.homeSiteId === s1?.id)?.id;
    const chief2 = siteStaff.find((m) => m.homeSiteId === s2?.id)?.id;
    const inquiries: Inquiry[] = [
      inq('자차카교회', '경기 남부', '담임목사', 'consult', 2, '소개 (기존 건축주)', '예배당 400석, 교육관 포함', '약 60억', '2027년 하반기 착공 희망', build[0]),
      inq('타파하교회', '충청', '건축위원장', 'visit', 9, '홈페이지 문의', '부지 1,200평, 신축', '미정', '2028년', inDept(deptOf(/CM/))[0]),
      inq('거너더교회', '서울 동부', '행정목사', 'new', 0, '전화 문의', '리모델링 (외벽·로비)', '약 8억', '내년 봄', undefined),
      inq('머버서교회', '전라', '담임목사', 'proposal', 3, '박람회', '예배당 250석 신축', '약 35억', '2027년 상반기', build[0]),
    ];
    function inq(church: string, region: string, contactName: string, stage: Inquiry['stage'], idleDays: number, source: string, scale: string, budget: string, timing: string, ownerId: string | undefined): Inquiry {
      const t = ago(60 * 24 * idleDays + 30);
      return { id: newId('inq'), church, region, contactName, phone: '010-0000-0000', scale, budget, timing, source, stage, ownerId: ownerId ?? null, note: '', createdBy: admin ?? ceo ?? '', createdAt: ago(60 * 24 * (idleDays + 6)), updatedAt: t, lastActivityAt: t, siteId: null };
    }
    const messages = [
      say('room_build', build[0], '이번 주 공정회의 자료 공유드립니다. 수정사항 있으면 오늘 중으로 알려 주세요.', 300),
      say('room_build', build[1], '견적 2건은 내일 오전까지 정리하겠습니다.', 260),
      say('room_build', ceo, '레미콘 수급 문제는 오늘 중으로 대안 정리해서 보고해 주세요.', 45),
      say('room_design', design[0], '사아자교회 예배당 색상 B안 3D 이미지 올립니다.', 200),
      say('room_design', design[1], '조명 배치도 1차 수정본 오후에 공유드리겠습니다.', 120),
      say('room_chief', ceo, '다음 주 각 현장 주요 작업 금요일까지 공유 바랍니다.', 60 * 26),
      say('room_chief', chief, `${s1?.name ?? '현장'}: 다음 주 화요일 3층 슬래브 타설 예정입니다.`, 60 * 20),
      say('room_safety', safety[0], '정기 안전점검 결과 비계 난간 보완이 필요합니다. 오늘 중 조치 바랍니다.', 60 * 5),
      say('room_safety', chief, '난간 보완 완료했습니다. 사진 첨부합니다.', 60 * 3),
      r1 ? say(r1.id, chief, '3층 벽체 거푸집 설치 중입니다. 오후 비 예보로 외부 작업 15시에 종료합니다.', 90) : null,
      r1 ? say(r1.id, build[0], '레미콘 업체 2곳 수급 확인했습니다. 화요일 타설 가능합니다.', 70) : null,
      r2 ? say(r2.id, chief2, '감리단 지적사항 2건 조치 계획서 제출했습니다.', 60 * 8) : null,
      say('room_inquiry', admin ?? ceo, '거너더교회 전화 문의 접수했습니다. 담당자 배정 부탁드립니다.', 25, { inquiryId: inquiries[2].id }),
      say('room_inquiry', build[0], '자차카교회 담임목사님과 2차 상담 일정 잡았습니다 (다음 주 목요일).', 60 * 48, { inquiryId: inquiries[0].id }),
      say('room_inquiry', build[0], '머버서교회 제안서 초안 공유드립니다. 검토 부탁드립니다.', 60 * 72, { inquiryId: inquiries[3].id }),
    ].filter(Boolean) as ChatMessage[];
    // 읽음: 대표님은 몇 개를 아직 안 읽은 상태, 나머지는 대부분 읽음
    const reads: TalkState['reads'] = {};
    for (const r of rooms) {
      reads[r.id] = {};
      const last = messages.filter((m) => m.roomId === r.id).map((m) => m.createdAt).sort().pop() ?? ago(60 * 24 * 30);
      r.memberIds.forEach((id, i) => { reads[r.id][id] = i % 3 === 2 ? ago(60 * 24) : last; });
      if (ceo && ['room_design', 'room_safety', 'room_inquiry'].includes(r.id)) reads[r.id][ceo] = ago(60 * 24 * 4);
    }
    const allIds = ms.map((m) => m.id);
    const notices: Notice[] = [
      {
        id: 'nt_1', title: '연말 현장 일제 안전점검 안내', authorId: ceo ?? '', createdAt: ago(60 * 24), updatedAt: ago(60 * 24), requireAck: true, pinned: true,
        body: '다음 주 월~수 전 현장 일제 안전점검을 실시합니다.\n- 비계·난간, 개구부 덮개, 가설 전기 중점 점검\n- 현장별 점검 결과는 일일보고에 남겨 주세요.\n확인 후 [확인] 버튼을 눌러 주세요.',
        reads: Object.fromEntries(allIds.slice(0, Math.ceil(allIds.length * 0.7)).map((id) => [id, ago(60 * 20)])),
        acks: Object.fromEntries(allIds.slice(0, Math.ceil(allIds.length * 0.5)).map((id) => [id, ago(60 * 19)])),
      },
      {
        id: 'nt_2', title: '업무보고 시스템으로 소통 채널 통일', authorId: ceo ?? '', createdAt: ago(60 * 24 * 3), updatedAt: ago(60 * 24 * 3), requireAck: false, pinned: false,
        body: '앞으로 업무 연락은 이 시스템의 채팅방으로 통일합니다. 텔레그램·카카오톡 업무방은 이번 달까지만 사용합니다.',
        reads: Object.fromEntries(allIds.map((id) => [id, ago(60 * 24 * 2)])), acks: {},
      },
    ];
    const base = import.meta.env.BASE_URL;
    const txt = sampleText as Record<string, string>;
    const doc = (category: string, docDate: string, title: string, note: string, file: string, by: string | undefined, daysAgo: number): SiteDoc | null => (s1 && by ? {
      id: newId('doc'), siteId: s1.id, category, docDate, title, note, fileName: file, fileType: 'pdf', url: `${base}demo/${file}`, size: 0,
      text: txt[file] ?? '', uploadedBy: by, createdAt: ago(60 * 24 * daysAgo), messageId: null,
    } : null);
    const docs = [
      doc(MINUTES, shiftDay(ctx.today(), -9), '주간 공정회의 (감리단·협력업체)', '감리단 지적사항 3건, 다음 주 타설 일정 확정', 'minutes-sample.pdf', chief, 9),
      doc('공사일보', shiftDay(ctx.today(), -1), '공사일보', '3층 기둥 타설 완료 (레미콘 18대)', 'daily-log-sample.pdf', chief, 1),
      doc('주간공정표', shiftDay(ctx.today(), 3), '주간 공정표 (10/26~10/31)', '3층 슬래브 타설 화요일', 'weekly-schedule-sample.pdf', build[0], 0),
    ].filter(Boolean) as SiteDoc[];
    return { v: 2, rooms, messages, reads, notices, inquiries, docs, tips: {}, settings: structuredClone(DEFAULT_TALK_SETTINGS) };
  }

  /* ───────── 권한 ───────── */
  const isTop = (m: Member) => m.isCeo || m.isAdmin;
  const myRooms = (m: Member) => st.rooms.filter((r) => r.memberIds.includes(m.id));
  function roomFor(id: string, m: Member): ChatRoom {
    const r = st.rooms.find((x) => x.id === id);
    if (!r || !r.memberIds.includes(m.id)) throw new ApiError('이 방에 들어가 있지 않습니다.');
    return r;
  }
  const inInquiryRoom = (m: Member) => st.rooms.some((r) => r.kind === 'inquiry' && r.memberIds.includes(m.id));
  const canSeeDocs = (m: Member, siteId: string) => m.isCeo || m.isAdmin || m.isExecutive
    || st.rooms.some((r) => r.kind === 'site' && r.siteId === siteId && r.memberIds.includes(m.id));

  function summary(r: ChatRoom, m: Member): RoomSummary {
    const list = st.messages.filter((x) => x.roomId === r.id);
    const mine = st.reads[r.id]?.[m.id] ?? '';
    return {
      room: structuredClone(r),
      last: list.length ? structuredClone(list[list.length - 1]) : null,
      unread: list.filter((x) => x.createdAt > mine && x.authorId !== m.id).length,
      reads: { ...(st.reads[r.id] ?? {}) },
    };
  }

  async function toAttachment(f: File): Promise<ChatAttachment> {
    if (f.type.startsWith('image/')) {
      const { blob, width, height } = await shrinkImage(f, 1600, 0.8);
      return { id: newId('att'), name: f.name, kind: 'image', url: await blobToDataUrl(blob), size: blob.size, width, height };
    }
    if (f.size > 2 * MB) throw new ApiError('체험판은 2MB 이하 파일만 올릴 수 있습니다.');
    return { id: newId('att'), name: f.name, kind: 'file', url: await blobToDataUrl(f), size: f.size };
  }

  function post(roomId: string, authorId: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const msg: ChatMessage = {
      id: newId('msg'), roomId, authorId, text, attachments: [], replyToId: null, mentions: [], createdAt: new Date().toISOString(), editedAt: null, deleted: false,
      inquiryId: null, directive: null, safety: false, system: false, hidden: null, docCategory: null, ...extra,
    };
    st.messages.push(msg);
    (st.reads[roomId] ??= {})[authorId] = msg.createdAt;
    return msg;
  }

  const nameOf = (id: string) => { const m = ctx.members().find((x) => x.id === id); return m ? m.name : ''; };

  return {
    async load() {
      const m = ctx.me();
      const showMsg = (x: ChatMessage | null) => (x && x.hidden && !m.isAdmin ? { ...x, text: '', attachments: [] } : x);
      const rooms = myRooms(m).map((r) => { const x = summary(r, m); x.last = showMsg(x.last); return x; })
        .sort((a, b) => (b.last?.createdAt ?? '').localeCompare(a.last?.createdAt ?? ''));
      const siteIds = new Set(ctx.sites().map((s) => s.id).filter((id) => canSeeDocs(m, id)));
      return delay({
        rooms,
        notices: structuredClone(st.notices).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)),
        inquiries: inInquiryRoom(m) ? structuredClone(st.inquiries) : [],
        docs: structuredClone(st.docs.filter((x) => siteIds.has(x.siteId))).sort((a, b) => b.docDate.localeCompare(a.docDate) || b.createdAt.localeCompare(a.createdAt)),
        settings: structuredClone(st.settings),
      });
    },

    async messages(roomId) {
      const m = ctx.me();
      roomFor(roomId, m);
      // 가린 메시지는 관리자만 내용을 본다
      return delay(structuredClone(st.messages.filter((x) => x.roomId === roomId)).map((x) => (x.hidden && !m.isAdmin ? { ...x, text: '', attachments: [] } : x)));
    },

    async send({ roomId, text, files = [], replyToId = null, inquiryId = null, docCategory = null }) {
      const m = ctx.me();
      const r = roomFor(roomId, m);
      const body = text.trim();
      if (!body && !files.length) throw new ApiError('보낼 내용을 입력하세요.');
      const attachments = await Promise.all(files.map(toAttachment));
      const names = ctx.members().filter((x) => r.memberIds.includes(x.id) && x.id !== m.id);
      const mentions = names.filter((x) => body.includes(`@${x.name}`)).map((x) => x.id);
      const toDocs = !!(docCategory && r.siteId && files.length);
      const msg = post(roomId, m.id, body, { attachments, replyToId, mentions, inquiryId, docCategory: toDocs ? docCategory : null });
      if (toDocs) {
        for (const [i, f] of files.entries()) {
          const a = attachments[i];
          const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
          st.docs.push({
            id: newId('doc'), siteId: r.siteId!, category: docCategory!, docDate: ctx.today(), title: f.name.replace(/\.[^.]+$/, ''), note: body.slice(0, 80),
            fileName: f.name, fileType: a.kind === 'image' ? 'image' : isPdf ? 'pdf' : 'file', url: a.url, size: a.size,
            text: isPdf ? await pdfText(a.url).catch(() => '') : '', uploadedBy: m.id, createdAt: msg.createdAt, messageId: msg.id,
          });
        }
      }
      if (inquiryId) { const q = st.inquiries.find((x) => x.id === inquiryId); if (q) q.lastActivityAt = msg.createdAt; }
      save();
      return structuredClone(msg);
    },

    async editMessage(id, text) {
      const m = ctx.me();
      const msg = st.messages.find((x) => x.id === id);
      if (!msg || msg.authorId !== m.id || msg.system) throw new ApiError('본인 메시지만 고칠 수 있습니다.');
      if (msg.deleted) throw new ApiError('지운 메시지입니다.');
      msg.text = text.trim();
      msg.editedAt = new Date().toISOString();
      save();
      return structuredClone(msg);
    },

    async deleteMessage(id) {
      const m = ctx.me();
      const msg = st.messages.find((x) => x.id === id);
      if (!msg) throw new ApiError('메시지를 찾을 수 없습니다.');
      if (!m.isAdmin) {
        if (msg.authorId !== m.id) throw new ApiError('본인 메시지만 지울 수 있습니다.');
        if (Date.now() - Date.parse(msg.createdAt) > st.settings.deleteMinutes * 60000) throw new ApiError(`보낸 뒤 ${st.settings.deleteMinutes}분이 지나 지울 수 없습니다. 고치기는 됩니다.`);
      }
      msg.deleted = true; msg.text = ''; msg.attachments = [];
      st.docs = st.docs.filter((d) => d.messageId !== msg.id);
      save();
    },

    async hideMessage(id, hidden) {
      const m = ctx.me();
      if (!m.isAdmin) throw new ApiError('관리자만 가릴 수 있습니다.');
      const msg = st.messages.find((x) => x.id === id);
      if (!msg) throw new ApiError('메시지를 찾을 수 없습니다.');
      msg.hidden = hidden ? { by: m.id, at: new Date().toISOString() } : null;
      save();
    },

    async markRead(roomId) {
      const m = ctx.me();
      roomFor(roomId, m);
      const last = st.messages.filter((x) => x.roomId === roomId).map((x) => x.createdAt).sort().pop();
      if (!last || (st.reads[roomId]?.[m.id] ?? '') >= last) return;
      (st.reads[roomId] ??= {})[m.id] = new Date().toISOString();
      save();
    },

    async setMuted(roomId, muted) {
      const m = ctx.me();
      const r = roomFor(roomId, m);
      r.mutedBy = muted ? [...new Set([...r.mutedBy, m.id])] : r.mutedBy.filter((x) => x !== m.id);
      save();
    },

    async pin(roomId, text) {
      const m = ctx.me();
      const r = roomFor(roomId, m);
      r.pinned = text.trim(); r.pinnedBy = text.trim() ? m.id : null; r.pinnedAt = text.trim() ? new Date().toISOString() : null;
      save();
    },

    async openDm(memberId) {
      const m = ctx.me();
      if (memberId === m.id) throw new ApiError('본인과는 대화할 수 없습니다.');
      const other = ctx.members().find((x) => x.id === memberId && x.active);
      if (!other) throw new ApiError('대화 상대를 찾을 수 없습니다.');
      let r = st.rooms.find((x) => x.kind === 'dm' && x.memberIds.length === 2 && x.memberIds.includes(m.id) && x.memberIds.includes(memberId));
      if (!r) {
        r = { id: newId('dm'), kind: 'dm', name: '', siteId: null, memberIds: [m.id, memberId], pinned: '', pinnedBy: null, pinnedAt: null, mutedBy: [], meetingDow: null, sort: 0, createdAt: new Date().toISOString() };
        st.rooms.push(r);
        save();
      }
      return structuredClone(r);
    },

    async toDirective({ messageId, text, memberIds, siteId }) {
      const m = ctx.me();
      if (!m.isCeo) throw new ApiError('지시 등록은 대표님만 할 수 있습니다.');
      const msg = st.messages.find((x) => x.id === messageId);
      if (!msg) throw new ApiError('메시지를 찾을 수 없습니다.');
      roomFor(msg.roomId, m);
      const line = text.trim();
      if (!line) throw new ApiError('지시 내용을 입력하세요.');
      if (!memberIds.length && !siteId) throw new ApiError('지시를 받을 사람이나 현장을 고르세요.');
      memberIds.forEach((id) => ctx.appendDirective({ memberId: id }, line));
      if (siteId) ctx.appendDirective({ siteId }, line);
      msg.directive = { memberIds, siteId, by: m.id, at: new Date().toISOString() };
      const who = [...memberIds.map(nameOf), ...(siteId ? [ctx.sites().find((s) => s.id === siteId)?.name ?? '현장'] : [])].join(', ');
      post(msg.roomId, m.id, `지시사항으로 등록했습니다 → ${who}`, { system: true, replyToId: msg.id, mentions: memberIds });
      save();
    },

    notices: {
      async save(n) {
        const m = ctx.me();
        if (!(m.isCeo || (m.isAdmin && st.settings.adminCanNotice))) throw new ApiError('전체 공지는 대표님만 쓸 수 있습니다.');
        if (!n.title.trim()) throw new ApiError('제목을 입력하세요.');
        const now = new Date().toISOString();
        let x = n.id ? st.notices.find((y) => y.id === n.id) : undefined;
        if (!x) { x = { id: newId('nt'), authorId: m.id, createdAt: now, reads: { [m.id]: now }, acks: {}, title: '', body: '', requireAck: false, pinned: false, updatedAt: now }; st.notices.push(x); }
        Object.assign(x, { title: n.title.trim(), body: n.body.trim(), requireAck: n.requireAck, pinned: n.pinned, updatedAt: now });
        save();
        return structuredClone(x);
      },
      async remove(id) {
        const m = ctx.me();
        if (!(m.isCeo || (m.isAdmin && st.settings.adminCanNotice))) throw new ApiError('공지는 대표님만 지울 수 있습니다.');
        st.notices = st.notices.filter((x) => x.id !== id);
        save();
      },
      async read(id) {
        const m = ctx.me();
        const x = st.notices.find((y) => y.id === id);
        if (!x || x.reads[m.id]) return;
        x.reads[m.id] = new Date().toISOString();
        save();
      },
      async ack(id) {
        const m = ctx.me();
        const x = st.notices.find((y) => y.id === id);
        if (!x) throw new ApiError('공지를 찾을 수 없습니다.');
        const now = new Date().toISOString();
        x.reads[m.id] ??= now; x.acks[m.id] ??= now;
        save();
      },
      async remind(id) {
        if (!isTop(ctx.me())) throw new ApiError('대표님과 관리자만 다시 알릴 수 있습니다.');
        const x = st.notices.find((y) => y.id === id);
        if (!x) throw new ApiError('공지를 찾을 수 없습니다.');
        return delay(ctx.members().filter((mm) => mm.active && !(x.requireAck ? x.acks : x.reads)[mm.id]).length);
      },
    },

    inquiries: {
      async save(i) {
        const m = ctx.me();
        if (!inInquiryRoom(m)) throw new ApiError('문의방 인원만 문의를 관리할 수 있습니다.');
        if (!i.church.trim()) throw new ApiError('교회 이름을 입력하세요.');
        const now = new Date().toISOString();
        const old = st.inquiries.find((x) => x.id === i.id);
        const next: Inquiry = { ...i, church: i.church.trim(), updatedAt: now, lastActivityAt: now, createdBy: old?.createdBy ?? m.id, createdAt: old?.createdAt ?? now };
        const room = st.rooms.find((r) => r.kind === 'inquiry');
        if (old) {
          if (room && old.stage !== next.stage) post(room.id, m.id, `단계 변경: ${INQUIRY_STAGES.find((s) => s.id === old.stage)?.label} → ${INQUIRY_STAGES.find((s) => s.id === next.stage)?.label}`, { system: true, inquiryId: i.id });
          if (room && old.ownerId !== next.ownerId && next.ownerId) post(room.id, m.id, `담당자 지정: ${nameOf(next.ownerId)}`, { system: true, inquiryId: i.id, mentions: [next.ownerId] });
          st.inquiries = st.inquiries.map((x) => (x.id === i.id ? next : x));
        } else {
          st.inquiries.push(next);
          if (room) post(room.id, m.id, `새 문의 등록: ${next.church} (${next.region || '지역 미정'})`, { system: true, inquiryId: next.id, mentions: next.ownerId ? [next.ownerId] : [] });
        }
        save();
        return structuredClone(next);
      },
      async remove(id) {
        const m = ctx.me();
        if (!isTop(m)) throw new ApiError('문의 삭제는 대표님과 관리자만 할 수 있습니다.');
        st.inquiries = st.inquiries.filter((x) => x.id !== id);
        st.messages = st.messages.filter((x) => x.inquiryId !== id);
        save();
      },
      async toSite(id) {
        const m = ctx.me();
        if (!isTop(m)) throw new ApiError('현장 등록은 대표님과 관리자만 할 수 있습니다.');
        const q = st.inquiries.find((x) => x.id === id);
        if (!q) throw new ApiError('문의를 찾을 수 없습니다.');
        if (q.siteId) throw new ApiError('이미 현장으로 넘긴 문의입니다.');
        const stage = ctx.stages().find((s) => s.id === 'sales' || /영업/.test(s.label))?.id ?? ctx.stages()[ctx.stages().length - 1]?.id ?? 'sales';
        const site: Site = {
          id: newId('s'), name: q.church, note: [q.region, q.contactName].filter(Boolean).join(' · '), stage, dueDate: null, dueText: q.timing, process: '영업',
          progress: null, scale: q.scale, tags: [], sort: Math.max(0, ...ctx.sites().map((s) => s.sort)) + 1, archived: false, completedAt: null, extra: {},
        };
        ctx.createSite(site);
        q.siteId = site.id; q.stage = 'won'; q.updatedAt = q.lastActivityAt = new Date().toISOString();
        const room = st.rooms.find((r) => r.kind === 'inquiry');
        if (room) post(room.id, m.id, `영업 현장으로 등록했습니다: ${site.name}`, { system: true, inquiryId: q.id });
        save();
        return structuredClone(site);
      },
    },

    docs: {
      async upload({ siteId, category, docDate, title, note, file }) {
        const m = ctx.me();
        if (!canSeeDocs(m, siteId)) throw new ApiError('이 현장방 인원만 자료를 올릴 수 있습니다.');
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        const isImage = file.type.startsWith('image/');
        let url: string; let size = file.size;
        if (isImage) {
          const sh = await shrinkImage(file, 2000, 0.8);
          url = await blobToDataUrl(sh.blob); size = sh.blob.size;
        } else {
          if (file.size > 3 * MB) throw new ApiError('체험판은 3MB 이하 파일만 올릴 수 있습니다.');
          url = await blobToDataUrl(file);
        }
        const x: SiteDoc = {
          id: newId('doc'), siteId, category, docDate, title: title.trim() || category, note: note.trim(), fileName: file.name,
          fileType: isPdf ? 'pdf' : isImage ? 'image' : 'file', url, size, text: isPdf ? await pdfText(url).catch(() => '') : '',
          uploadedBy: m.id, createdAt: new Date().toISOString(), messageId: null,
        };
        st.docs.push(x);
        const room = st.rooms.find((r) => r.kind === 'site' && r.siteId === siteId);
        if (room) post(room.id, m.id, `${category}를 올렸습니다: ${x.title} (${docDate})`, { system: true });
        save();
        return structuredClone(x);
      },
      async remove(id) {
        const m = ctx.me();
        const x = st.docs.find((y) => y.id === id);
        if (!x) return;
        if (x.uploadedBy !== m.id && !isTop(m)) throw new ApiError('올린 사람과 관리자만 지울 수 있습니다.');
        st.docs = st.docs.filter((y) => y.id !== id);
        save();
      },
      async requestMinutes(siteId) {
        const m = ctx.me();
        const room = st.rooms.find((r) => r.kind === 'site' && r.siteId === siteId);
        if (!room || !room.memberIds.includes(m.id)) throw new ApiError('이 현장방 인원만 요청할 수 있습니다.');
        const others = room.memberIds.filter((id) => id !== m.id);
        post(room.id, m.id, '이번 주 정기회의 회의록이 아직 없습니다. 회의 후 회의록(PDF 또는 사진)을 [자료] 칸에 올려 주세요.', { system: true, mentions: others });
        save();
      },
      async corpus(from) {
        const m = ctx.me();
        if (!m.isCeo) return [];
        return delay(st.docs.filter((d) => d.docDate >= from && d.text.trim()).map((d): SearchDoc => ({
          id: d.id, kind: 'doc', date: d.docDate, siteId: d.siteId, departmentId: null, memberId: d.uploadedBy, content: `${d.title}\n${d.note}\n${d.text}`.trim(), docCategory: d.category, docTitle: d.title,
        })));
      },
    },

    safety: {
      async suggestions(date) {
        const m = ctx.me();
        if (!m.isCeo) return [];
        const until = shiftDay(date, 3);
        const out: SafetyTip[] = [];
        for (const site of ctx.sites().filter((s) => !s.archived)) {
          const lines = [
            ...ctx.daily().filter((r) => r.date === date && r.siteId === site.id).flatMap((r) => strip(r.content).split(/ ?[-■•] /).map((l) => l.trim()).filter(Boolean).map((l) => `일일보고 (${nameOf(r.authorId)}): ${l}`)),
            ...ctx.events().filter((e) => e.siteId === site.id && e.startDate >= date && e.startDate <= until).map((e) => `일정 ${e.startDate.slice(5).replace('-', '/')}: ${e.title}`),
          ];
          const hits = RULES.map((rule) => ({ rule, src: lines.filter((l) => rule.re.test(l)) })).filter((h) => h.src.length);
          if (!hits.length) continue;
          const key = `${date}|${site.id}`;
          const status = st.tips[key] ?? 'new';
          const roomIds = st.rooms.filter((r) => (r.kind === 'safety') || (r.kind === 'site' && r.siteId === site.id)).map((r) => r.id);
          const text = `[${site.name} 안전 당부]\n${hits.map((h) => `· ${h.rule.label}: ${h.rule.tip}`).join('\n')}\n작업 전 TBM에서 꼭 공유하고, 조치 결과는 일일보고에 남겨 주세요.`;
          out.push({ id: key, date, siteId: site.id, sources: [...new Set(hits.flatMap((h) => h.src))].slice(0, 5), text, roomIds, status });
        }
        return delay(out);
      },
      async send(tip, text, roomIds) {
        const m = ctx.me();
        if (!m.isCeo) throw new ApiError('대표님만 보낼 수 있습니다.');
        if (!roomIds.length) throw new ApiError('보낼 방을 고르세요.');
        for (const id of roomIds) { roomFor(id, m); post(id, m.id, text.trim(), { safety: true }); }
        st.tips[tip.id] = 'sent';
        save();
      },
      async dismiss(tip) {
        st.tips[tip.id] = 'dismissed';
        save();
      },
    },

    admin: {
      async rooms() {
        if (!ctx.me().isAdmin) throw new ApiError('관리자만 볼 수 있습니다.');
        return delay(structuredClone(st.rooms.filter((r) => r.kind !== 'dm')).sort((a, b) => a.sort - b.sort));
      },
      async saveRoom(r) {
        if (!ctx.me().isAdmin) throw new ApiError('관리자만 방을 관리할 수 있습니다.');
        if (r.kind === 'dm') throw new ApiError('1:1 대화방은 관리할 수 없습니다.');
        if (!r.name.trim()) throw new ApiError('방 이름을 입력하세요.');
        // 종류는 따로 고르지 않는다: 현장을 연결하면 현장방, 아니면 일반 방 (문의방·안전방은 처음부터 있는 방)
        const kind = isBuiltinRoom(r) ? r.kind : r.siteId ? 'site' : 'group';
        const next: ChatRoom = { ...r, kind, siteId: isBuiltinRoom(r) ? null : r.siteId, meetingDow: kind === 'site' ? r.meetingDow : null, name: r.name.trim(), memberIds: [...new Set(r.memberIds)] };
        const i = st.rooms.findIndex((x) => x.id === r.id);
        if (i >= 0) st.rooms[i] = next; else { st.rooms.push(next); st.reads[next.id] = {}; }
        save();
        return structuredClone(next);
      },
      async deleteRoom(id) {
        if (!ctx.me().isAdmin) throw new ApiError('관리자만 방을 지울 수 있습니다.');
        const r = st.rooms.find((x) => x.id === id);
        if (r && isBuiltinRoom(r)) throw new ApiError('문의방·안전방은 기본 방이라 지울 수 없습니다. 인원만 바꿀 수 있습니다.');
        st.rooms = st.rooms.filter((x) => x.id !== id);
        st.messages = st.messages.filter((x) => x.roomId !== id);
        delete st.reads[id];
        save();
      },
      async saveSettings(s) {
        if (!ctx.me().isAdmin) throw new ApiError('관리자만 바꿀 수 있습니다.');
        st.settings = structuredClone(s);
        save();
        return structuredClone(s);
      },
    },
  };
}

/** 체험판 초기화 때 소통 데이터도 지운다 */
export function resetDemoTalk() {
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
}
