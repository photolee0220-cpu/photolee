import type {
  AiSummary, AppSettings, Attachment, Comment, Department, Directive, Entry, Grant, Member, NewAttachmentInput, NewMemberInput, NewPhotoInput, Photo, SaveDirectiveInput, SaveEntryInput, Site, Snapshot, StageDef, StorageUsage, WeekId,
} from './types';

export interface WeekSummary {
  weekId: WeekId;
  entryCount: number;
  writers: number;
}

export interface SiteHistoryItem {
  weekId: WeekId;
  directive: Directive | null;
  entries: Entry[];
  photos: Photo[];
}

export interface Api {
  mode: 'demo' | 'supabase';
  getSession(): Promise<Member | null>;
  signIn(username: string, password: string): Promise<Member>;
  signOut(): Promise<void>;
  changePassword(newPassword: string): Promise<void>;

  loadWeek(weekId: WeekId): Promise<Snapshot>;
  listWeeks(): Promise<WeekSummary[]>;
  siteHistory(siteId: string): Promise<SiteHistoryItem[]>;
  saveEntry(input: SaveEntryInput): Promise<Entry>;
  saveDirective(input: SaveDirectiveInput): Promise<Directive>;
  addComment(entryId: string, content: string): Promise<Comment>;
  acknowledgeComment(id: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
  uploadPhoto(input: NewPhotoInput): Promise<Photo>;
  deletePhoto(id: string): Promise<void>;
  uploadAttachment(input: NewAttachmentInput): Promise<Attachment>;
  deleteAttachment(id: string): Promise<void>;
  /** 파일 내려받기 (서버는 잠깐 쓰는 서명 주소로 받는다) */
  downloadAttachment(a: Attachment): Promise<void>;
  /** 대표 전용 AI 주간 요약 */
  getAiSummary(weekId: WeekId): Promise<AiSummary | null>;
  generateAiSummary(weekId: WeekId, prompt: string, sourceUpdatedAt: string): Promise<AiSummary>;
  getSettings(): Promise<AppSettings>;
  /** 다른 사람이 바꾼 내용이 생기면 호출된다 */
  subscribe(onChange: () => void): () => void;

  admin: {
    saveSite(site: Site): Promise<Site>;
    saveStage(stage: StageDef): Promise<StageDef>;
    /** 현장이 남아 있는 단계는 지울 수 없다 */
    deleteStage(id: string): Promise<void>;
    saveDepartment(d: Department): Promise<Department>;
    deleteDepartment(id: string): Promise<void>;
    setGrants(viewerDepartmentId: string, targetIds: string[]): Promise<Grant[]>;
    createMember(input: NewMemberInput): Promise<Member>;
    updateMember(m: Member): Promise<Member>;
    /** 로그인 아이디 변경 (비밀번호는 그대로) */
    changeUsername(memberId: string, username: string): Promise<Member>;
    resetPassword(memberId: string, password: string): Promise<void>;
    saveSettings(s: AppSettings): Promise<AppSettings>;
    storageUsage(): Promise<StorageUsage>;
    /** 이 주차보다 오래된 사진·첨부파일을 지운다 (보고 글은 남김) */
    cleanupMedia(beforeWeekId: WeekId): Promise<{ photos: number; files: number; bytes: number }>;
  };

  /** 데모 전용: 계정 전환 */
  demo?: {
    accounts(): Member[];
    signInAs(memberId: string): Promise<Member>;
    reset(): void;
  };
}

export const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class ApiError extends Error {}
