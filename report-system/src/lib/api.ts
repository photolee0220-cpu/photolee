import type {
  AiSummary, AppSettings, Attachment, Comment, Department, Directive, Entry, Grant, Member, NewAttachmentInput, NewMemberInput, NewPhotoInput, Photo, SaveDirectiveInput, SaveEntryInput, Site, Snapshot, StageDef, StorageUsage, WeekId, BackupInfo, DirectiveStatus, EntryVersion, SiteSummary, SiteField, PendingFeedback, MediaItem,
  CalendarEvent, DailyComment, DailyPhoto, DailyReport, DailySnapshot, SaveDailyInput,
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
  /** 지시사항 처리 상태 (담당자·대표·관리자) */
  setDirectiveStatus(id: string, status: DirectiveStatus): Promise<Directive>;
  /** 지난 주차까지 모든 지시사항 (볼 수 있는 것만), 최신 주차부터 */
  directiveHistory(): Promise<Directive[]>;
  /** 확인 전인 대표·본부장 피드백 (지난 주차 포함) */
  pendingFeedback(): Promise<PendingFeedback[]>;
  /** 보고 칸의 예전 내용, 최신순 */
  entryHistory(entryId: string): Promise<EntryVersion[]>;
  /** 대표·관리자: 현장 기간 요약 */
  getSiteSummary(siteId: string): Promise<SiteSummary | null>;
  generateSiteSummary(siteId: string, months: number, prompt: string): Promise<SiteSummary>;
  push: {
    /** 이 브라우저에서 알림을 쓸 수 있는지 (체험판은 불가) */
    available: boolean;
    publicKey(): Promise<string>;
    save(sub: PushSubscriptionJSON): Promise<void>;
    remove(endpoint: string): Promise<void>;
    test(): Promise<number>;
  };
  /** 일일 업무보고 (볼 수 있는 사람의 것만) */
  daily: {
    load(date: string): Promise<DailySnapshot>;
    /** 내 칸 저장. 당일에만 (관리자는 언제나). 내용을 비우고 현장 칸이면 칸이 지워진다 */
    save(input: SaveDailyInput): Promise<DailyReport | null>;
    uploadPhoto(input: { date: string; siteId: string | null; blob: Blob; width: number; height: number }): Promise<DailyPhoto>;
    deletePhoto(id: string): Promise<void>;
    addComment(date: string, memberId: string, content: string): Promise<DailyComment>;
    acknowledge(id: string): Promise<void>;
    deleteComment(id: string): Promise<void>;
    /** 내 일일보고에 달린 확인 전 피드백 (지난 날짜 포함) */
    pending(): Promise<DailyComment[]>;
  };
  /** 공유 캘린더 */
  calendar: {
    /** from~to(포함)에 걸치는 일정 중 볼 수 있는 것 */
    list(from: string, to: string): Promise<CalendarEvent[]>;
    save(e: CalendarEvent): Promise<CalendarEvent>;
    remove(id: string): Promise<void>;
  };
  /** 다른 사람이 바꾼 내용이 생기면 호출된다 */
  subscribe(onChange: () => void): () => void;

  admin: {
    saveSite(site: Site): Promise<Site>;
    /** 현장과 그 현장의 모든 주차 기록(보고·지시·피드백·사진·첨부)을 영구 삭제 */
    deleteSite(id: string): Promise<void>;
    saveSiteField(f: SiteField): Promise<SiteField>;
    /** 항목을 지우면 현장마다 넣은 값도 화면에서 사라진다 */
    deleteSiteField(id: string): Promise<void>;
    /** 기간의 사진·첨부파일 목록과 내려받기 주소 (fromWeek 이상, beforeWeek 미만) */
    listMedia(fromWeek: WeekId | null, beforeWeek: WeekId): Promise<MediaItem[]>;
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
    listBackups(): Promise<BackupInfo[]>;
    createBackup(): Promise<void>;
    downloadBackup(b: BackupInfo): Promise<void>;
    /** 알림을 켜 둔 사람 */
    pushMembers(): Promise<string[]>;
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
