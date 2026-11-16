import type { SearchDoc, Site } from './types';

/** 소통(공지·채팅방) 데이터. 체험판에서 먼저 보여 주고, 승인 뒤 서버에 붙인다 */

/** group: 부서방·소장방 등 일반 방 / site: 현장방(회의록 칸) / inquiry: 신규 교회건축 문의방 / safety: 안전방 / dm: 1:1 */
export type RoomKind = 'group' | 'site' | 'inquiry' | 'safety' | 'dm';

export const ROOM_KIND_LABEL: Record<RoomKind, string> = {
  group: '일반', site: '현장', inquiry: '문의', safety: '안전', dm: '1:1',
};

export interface ChatRoom {
  id: string;
  kind: RoomKind;
  name: string;
  /** 현장방이면 그 현장 */
  siteId: string | null;
  /** 들어 있는 사람 (관리자가 넣고 뺀다. 1:1은 두 사람) */
  memberIds: string[];
  /** 방 맨 위에 고정한 공지 */
  pinned: string;
  pinnedBy: string | null;
  pinnedAt: string | null;
  /** 이 방 알림을 끈 사람 */
  mutedBy: string[];
  /** 현장방: 정기 회의 요일 (0=일 … 6=토), 없으면 null */
  meetingDow: number | null;
  sort: number;
  createdAt: string;
}

export interface ChatAttachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  /** 체험판은 data URL, 서버는 잠깐 쓰는 서명 주소 */
  url: string;
  size: number;
  width?: number;
  height?: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  authorId: string;
  text: string;
  attachments: ChatAttachment[];
  replyToId: string | null;
  /** @로 부른 사람 */
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  /** 보낸 뒤 5분 안에 본인이 지운 메시지 */
  deleted: boolean;
  /** 문의방: 어느 문의 카드의 대화인지 */
  inquiryId: string | null;
  /** 대표님이 지시로 등록한 메시지 */
  directive: { memberIds: string[]; siteId: string | null; by: string; at: string } | null;
  /** 안전 전달 (대표님이 보낸 주의 안내) */
  safety: boolean;
  /** 시스템 안내 (회의록 요청, 지시 등록 알림 등) */
  system: boolean;
  /** 관리자가 가린 메시지 (다시 보이게 할 수 있다) */
  hidden: { by: string; at: string } | null;
  /** 이 메시지에 붙인 파일 중 자료실에 들어간 종류 */
  docCategory: string | null;
}

/** 방 목록 한 줄: 방 + 마지막 메시지 + 안 읽은 수 + 사람별 마지막으로 읽은 때 */
export interface RoomSummary {
  room: ChatRoom;
  last: ChatMessage | null;
  unread: number;
  /** 사람 id → 마지막으로 읽은 때 (메시지 옆 '안 읽은 사람 수'에 쓴다) */
  reads: Record<string, string>;
}

export interface Notice {
  id: string;
  title: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  /** 직원이 [확인]을 눌러야 하는 공지 */
  requireAck: boolean;
  pinned: boolean;
  /** 사람 id → 읽은 때 */
  reads: Record<string, string>;
  /** 사람 id → [확인] 누른 때 */
  acks: Record<string, string>;
}

export type InquiryStage = 'new' | 'consult' | 'visit' | 'proposal' | 'won' | 'closed' | 'hold' | 'lost';
export const INQUIRY_STAGES: { id: InquiryStage; label: string; open: boolean }[] = [
  { id: 'new', label: '접수', open: true },
  { id: 'consult', label: '상담', open: true },
  { id: 'visit', label: '현장 답사', open: true },
  { id: 'proposal', label: '견적·제안', open: true },
  { id: 'won', label: '계약', open: false },
  { id: 'closed', label: '상담 완료', open: false },
  { id: 'hold', label: '보류', open: false },
  { id: 'lost', label: '무산', open: false },
];
/** 진행 중인 문의가 이 날수 동안 아무 진행이 없으면 담당자에게 알린다 */
export const INQUIRY_STALE_DAYS = 7;

export interface Inquiry {
  id: string;
  church: string;
  region: string;
  contactName: string;
  phone: string;
  scale: string;
  budget: string;
  timing: string;
  /** 소개, 홈페이지, 전화 등 */
  source: string;
  stage: InquiryStage;
  ownerId: string | null;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 단계 변경·대화가 마지막으로 있었던 때 */
  lastActivityAt: string;
  /** 현장으로 넘긴 경우 그 현장 */
  siteId: string | null;
}

/** 현장 자료: 회의록·공사일보·주간/월간 공정표 등 (현장방 [자료] 칸과 자료실) */
export interface SiteDoc {
  id: string;
  siteId: string;
  /** 회의록, 공사일보, 주간공정표 … (관리자가 종류를 더할 수 있다) */
  category: string;
  /** 자료의 날짜 (회의한 날, 일보 날짜 등) YYYY-MM-DD */
  docDate: string;
  title: string;
  note: string;
  fileName: string;
  fileType: 'pdf' | 'image' | 'file';
  /** 체험판은 data URL 또는 견본 파일 주소 */
  url: string;
  size: number;
  /** PDF에서 뽑은 글자 (AI 검색용). 사진·스캔본은 실제 버전에서 AI가 읽어 채운다 */
  text: string;
  uploadedBy: string;
  createdAt: string;
  /** 채팅에 붙여 올렸으면 그 메시지 */
  messageId: string | null;
}

export const DEFAULT_DOC_CATEGORIES = ['회의록', '공사일보', '주간공정표', '월간공정표', '기타'];
export const MINUTES = '회의록';

/** 대표님께 보이는 '안전 전달 제안' (보고·일정에서 위험 작업을 찾아 문장을 만들어 둔다) */
export interface SafetyTip {
  id: string;
  date: string;
  siteId: string;
  /** 무엇을 보고 제안했는지 (보고·일정 원문 한 줄) */
  sources: string[];
  /** 보낼 문장 초안 */
  text: string;
  /** 기본으로 보낼 방 */
  roomIds: string[];
  status: 'new' | 'sent' | 'dismissed';
}

export interface TalkSettings {
  /** 알림 쉬는 시간: 이 시간에는 채팅 알림을 보내지 않는다 (공지·@부르기는 예외) */
  quiet: { enabled: boolean; from: string; to: string };
  /** 보낸 뒤 본인이 지울 수 있는 시간(분). 관리자는 언제든 가리거나 지운다 */
  deleteMinutes: number;
  /** 전체 공지는 대표님이 쓴다. 켜면 관리자도 쓸 수 있다 */
  adminCanNotice: boolean;
  /** 자료 종류 */
  docCategories: string[];
}

export const DEFAULT_TALK_SETTINGS: TalkSettings = {
  quiet: { enabled: true, from: '22:00', to: '07:00' }, deleteMinutes: 5, adminCanNotice: false, docCategories: [...DEFAULT_DOC_CATEGORIES],
};

/** 처음부터 있는 특별한 방 (관리자는 인원만 넣고 뺀다) */
export const BUILTIN_ROOMS = { inquiry: 'room_inquiry', safety: 'room_safety' } as const;
export const isBuiltinRoom = (r: ChatRoom) => r.kind === 'inquiry' || r.kind === 'safety';

export interface TalkSnapshot {
  rooms: RoomSummary[];
  notices: Notice[];
  inquiries: Inquiry[];
  /** 내가 볼 수 있는 현장 자료 (대표·관리자·임원은 전부, 직원은 들어가 있는 현장방의 것) */
  docs: SiteDoc[];
  settings: TalkSettings;
}

export interface SendMessageInput {
  roomId: string;
  text: string;
  files?: File[];
  replyToId?: string | null;
  inquiryId?: string | null;
  /** 현장방에서 붙인 파일을 자료실에도 넣을 때 그 종류 */
  docCategory?: string | null;
}

export interface NoticeInput {
  id?: string;
  title: string;
  body: string;
  requireAck: boolean;
  pinned: boolean;
}

export interface TalkApi {
  /** 내가 들어 있는 방, 공지, (문의방 인원이면) 문의 카드, (현장방 인원이면) 회의록 */
  load(): Promise<TalkSnapshot>;
  messages(roomId: string): Promise<ChatMessage[]>;
  send(input: SendMessageInput): Promise<ChatMessage>;
  /** 본인 메시지 고치기 (고친 기록은 남는다) */
  editMessage(id: string, text: string): Promise<ChatMessage>;
  /** 본인은 보낸 뒤 정해진 시간 안에만, 관리자는 언제든 */
  deleteMessage(id: string): Promise<void>;
  /** 관리자: 가리기 / 다시 보이기 */
  hideMessage(id: string, hidden: boolean): Promise<void>;
  markRead(roomId: string): Promise<void>;
  setMuted(roomId: string, muted: boolean): Promise<void>;
  /** 방 공지 고정 (방 인원 누구나, 비우면 내림) */
  pin(roomId: string, text: string): Promise<void>;
  /** 1:1 대화방 열기 (없으면 만든다). 두 사람만 볼 수 있다 */
  openDm(memberId: string): Promise<ChatRoom>;
  /** 대표님: 채팅 메시지를 지시사항으로 등록 (이번 주 지시에 한 줄 덧붙인다) */
  toDirective(input: { messageId: string; text: string; memberIds: string[]; siteId: string | null }): Promise<void>;
  notices: {
    save(n: NoticeInput): Promise<Notice>;
    remove(id: string): Promise<void>;
    read(id: string): Promise<void>;
    ack(id: string): Promise<void>;
    /** 확인 안 한 사람에게 다시 알림. 보낸 사람 수 */
    remind(id: string): Promise<number>;
  };
  inquiries: {
    save(i: Inquiry): Promise<Inquiry>;
    remove(id: string): Promise<void>;
    /** 계약 진행: '영업' 단계 현장으로 넘긴다 */
    toSite(id: string): Promise<Site>;
  };
  docs: {
    upload(input: { siteId: string; category: string; docDate: string; title: string; note: string; file: File }): Promise<SiteDoc>;
    remove(id: string): Promise<void>;
    /** 현장방에 회의록 요청 안내를 남기고 방 인원에게 알린다 */
    requestMinutes(siteId: string): Promise<void>;
    /** 대표님 AI 검색용: from 이후 자료 중 글자가 있는 것 */
    corpus(from: string): Promise<SearchDoc[]>;
  };
  safety: {
    /** 그날 보고·앞으로 3일 일정에서 찾은 제안 (대표님만) */
    suggestions(date: string): Promise<SafetyTip[]>;
    send(tip: SafetyTip, text: string, roomIds: string[]): Promise<void>;
    dismiss(tip: SafetyTip): Promise<void>;
  };
  admin: {
    /** 1:1을 뺀 모든 방 (관리자) */
    rooms(): Promise<ChatRoom[]>;
    saveRoom(r: ChatRoom): Promise<ChatRoom>;
    deleteRoom(id: string): Promise<void>;
    saveSettings(s: TalkSettings): Promise<TalkSettings>;
  };
}
