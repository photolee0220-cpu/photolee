/** 현장 단계. 기본 3개(construction·cm·sales) 외에 관리자가 추가한다 */
export type Stage = string;

export interface StageDef {
  id: Stage;
  /** 묶음 제목 (예: 공사진행현장) */
  label: string;
  /** 탭·표시용 짧은 이름 (예: 공사진행) */
  short: string;
  sort: number;
}

/** 현장 설명 항목 (연면적, 도급금액처럼 관리자가 추가·삭제) */
export interface SiteField {
  id: string;
  label: string;
  sort: number;
}

/** 확인 전인 대표·본부장 피드백과 그 보고 칸 (지난 주차 포함) */
export interface PendingFeedback {
  comment: Comment;
  entry: Entry;
}

/** 내려받기용 사진·첨부파일 목록 */
export interface MediaItem {
  kind: 'photo' | 'file';
  weekId: WeekId;
  departmentId: string;
  siteId: string | null;
  authorId: string | null;
  fileName: string;
  sizeBytes: number;
  url: string;
}

export const DEFAULT_STAGES: StageDef[] = [
  { id: 'construction', label: '공사진행현장', short: '공사진행', sort: 1 },
  { id: 'cm', label: 'CM진행현장', short: 'CM', sort: 2 },
  { id: 'sales', label: '영업현장', short: '영업', sort: 3 },
];

/** CM·영업은 착공 전 단계. 그 밖의 단계(직접 추가한 단계 포함)는 공사진행처럼 공정율·준공일을 쓴다 */
export function isBuildStage(stage: Stage): boolean {
  return stage !== 'cm' && stage !== 'sales';
}

/** 현장 칸을 쓰는 부서마다 이번 주 작성 여부 (내용은 열람 권한이 있을 때만 entries에 있다) */
export interface SiteReportStatus {
  siteId: string;
  departmentId: string;
  updatedAt: string;
}

export const SITE_TAGS = ['잔금대기', '설계변경', '금융진행', '하자', '협력업체 선정', '소송·분쟁', '착공준비', '준공임박'] as const;

export interface Department {
  id: string;
  name: string;
  sort: number;
  /** 현장별 표에 칸을 가지는 부서 (공무, 인테리어/디자인, CM, 견적) */
  writesSites: boolean;
  active: boolean;
  /** 부서 안 보고: 부서원은 대표님이 아니라 부서장에게 일일보고를 쓴다 */
  internalReport?: boolean;
  /** 부서장 (부서 안 보고일 때 부서원 보고를 받는 사람) */
  headId?: string | null;
}

export interface Member {
  id: string;
  username: string;
  name: string;
  title: string;
  departmentId: string | null;
  isCeo: boolean;
  isAdmin: boolean;
  /** 전체 열람·코멘트 (예: 건설 본부장). 보고는 쓰지 않는다 */
  isExecutive: boolean;
  active: boolean;
  mustChangePassword: boolean;
  /** 소속: 본사 또는 현장 (일일보고를 나눠 볼 때 쓴다) */
  affiliation?: Affiliation;
  /** 현장 소속이면 근무하는 현장 */
  homeSiteId?: string | null;
  /** 일일보고 작성 대상 (관리자가 끌 수 있다) */
  dailyEnabled?: boolean;
}

export type Affiliation = 'hq' | 'site';

/** 일일 업무보고 한 칸. 본사 직원은 일반 업무(siteId 없음)와 현장별 칸을, 현장 직원은 소속 현장 칸 하나를 쓴다 */
export interface DailyReport {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  authorId: string;
  departmentId: string;
  siteId: string | null;
  /** 쓸 때의 소속 (나중에 소속이 바뀌어도 그날 보고는 그대로 분류) */
  authorKind: Affiliation;
  /** 부서 안 보고 부서원의 보고: 그 부서 안에서만 보인다 */
  internal?: boolean;
  content: string;
  updatedAt: string;
}

export interface DailyPhoto {
  id: string;
  date: string;
  authorId: string;
  departmentId: string;
  siteId: string | null;
  internal?: boolean;
  width: number;
  height: number;
  createdAt: string;
  url: string;
}

/** 일일보고 피드백: 사람·날짜 단위. 대표·본부장이 남기면 본인이 확인한다 */
export interface DailyComment {
  id: string;
  date: string;
  /** 누구의 일일보고에 단 글인지 */
  memberId: string;
  authorId: string;
  content: string;
  createdAt: string;
  /** 확인 전에 고친 시각 */
  editedAt?: string | null;
  acknowledgedAt: string | null;
}

/** 근무 상태 (연차·출장 등). 이 기간에는 일일보고 미작성으로 세지 않는다 (반차는 표시만) */
export type DayStatusKind = 'annual' | 'half' | 'vacation' | 'trip' | 'training' | 'off';
export const DAY_STATUS: { id: DayStatusKind; label: string }[] = [
  { id: 'annual', label: '연차' },
  { id: 'half', label: '반차' },
  { id: 'vacation', label: '휴가' },
  { id: 'trip', label: '출장' },
  { id: 'training', label: '교육' },
  { id: 'off', label: '휴무' },
];

export interface DayStatus {
  id: string;
  memberId: string;
  startDate: string;
  endDate: string;
  kind: DayStatusKind;
  memo: string;
  createdBy: string;
  createdAt: string;
}

export interface DailySnapshot {
  date: string;
  reports: DailyReport[];
  photos: DailyPhoto[];
  comments: DailyComment[];
  /** 이 날짜에 걸친 근무 상태 */
  statuses: DayStatus[];
}

export interface SaveDailyInput {
  date: string;
  siteId: string | null;
  content: string;
}

export type CalendarScope = 'dept' | 'all';

export interface CalendarEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** 하루 일정이면 startDate와 같다 */
  endDate: string;
  /** 'HH:MM' 또는 종일이면 빈 글자 */
  time: string;
  siteId: string | null;
  scope: CalendarScope;
  /** 만든 사람의 부서. 'dept' 일정은 이 부서를 볼 수 있는 사람에게 보인다 */
  departmentId: string | null;
  memo: string;
  createdBy: string;
  updatedAt: string;
}

export interface Site {
  id: string;
  name: string;
  /** 설계사무소, 금융기관 등 부가 정보 */
  note: string;
  stage: Stage;
  /** 준공예상일(공사) 또는 착공예상일(CM·영업), ISO 날짜 */
  dueDate: string | null;
  /** 날짜 대신 '미정' 같은 표기 */
  dueText: string;
  process: string;
  /** 0~100, 공정율이 없는 현장은 null */
  progress: number | null;
  /** 연면적, '리모델링' 같은 공정율 대신 표기 */
  scale: string;
  tags: string[];
  sort: number;
  archived: boolean;
  completedAt: string | null;
  /** 관리자가 정한 현장 설명 항목의 값 (항목 id → 값) */
  extra: Record<string, string>;
}

export interface Grant {
  viewerDepartmentId: string;
  targetDepartmentId: string;
}

/** 주차는 보고일(월요일) 날짜 문자열로 식별 */
export type WeekId = string;

export type EntryKind = 'site' | 'dept' | 'misc';

export interface Entry {
  id: string;
  weekId: WeekId;
  kind: EntryKind;
  siteId: string | null;
  departmentId: string;
  /** dept 보고는 사람별 */
  authorId: string | null;
  content: string;
  updatedAt: string;
  updatedBy: string | null;
  /** 이 칸에 내용을 쓴 적 있는 사람 모두 (함께 쓰는 현장 칸에서 작성 현황을 셀 때 쓴다) */
  writers?: string[];
}

export type DirectiveTarget = 'site' | 'member' | 'misc';
export type MiscSlot = 'ceo_progress' | 'requests' | 'special';

export const MISC_SLOTS: { id: MiscSlot; label: string; everyone: boolean }[] = [
  { id: 'special', label: '주간 특별 지시사항', everyone: true },
  { id: 'ceo_progress', label: '대표 진행사항', everyone: false },
  { id: 'requests', label: '의뢰 진행 내용', everyone: false },
];

export interface Directive {
  id: string;
  weekId: WeekId;
  targetKind: DirectiveTarget;
  siteId: string | null;
  memberId: string | null;
  slot: MiscSlot | null;
  content: string;
  updatedAt: string;
  /** 처리 상태: 대기 · 진행 중 · 완료 */
  status: DirectiveStatus;
  statusBy: string | null;
  statusAt: string | null;
}

export type DirectiveStatus = 'open' | 'doing' | 'done';
export const DIRECTIVE_STATUS: { id: DirectiveStatus; label: string }[] = [
  { id: 'open', label: '대기' },
  { id: 'doing', label: '진행 중' },
  { id: 'done', label: '완료' },
];

/** 보고 칸의 예전 내용 (수정 기록) */
export interface EntryVersion {
  content: string;
  editedBy: string | null;
  editedAt: string;
}

export interface BackupInfo {
  id: number;
  createdAt: string;
  kind: 'auto' | 'manual';
  sizeBytes: number;
}

/** 현장 여러 달 기록의 AI 요약 */
export interface SiteSummary {
  siteId: string;
  months: number;
  overview: string;
  milestones: { weekId: WeekId; text: string }[];
  issues: string[];
  model: string;
  generatedAt: string;
}

export interface Comment {
  id: string;
  entryId: string;
  authorId: string;
  content: string;
  createdAt: string;
  /** 확인 전에 고친 시각 */
  editedAt?: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface Photo {
  id: string;
  weekId: WeekId;
  siteId: string;
  departmentId: string;
  uploadedBy: string;
  caption: string;
  createdAt: string;
  width: number;
  height: number;
  /** 화면에 바로 쓸 수 있는 주소 (서버는 잠깐 쓰는 서명 주소) */
  url: string;
}

export interface NewPhotoInput {
  weekId: WeekId;
  siteId: string;
  departmentId: string;
  blob: Blob;
  width: number;
  height: number;
  caption: string;
}

/** 보고 칸에 붙인 파일 (PDF, 엑셀, 한글 등) */
export interface Attachment {
  id: string;
  weekId: WeekId;
  kind: EntryKind;
  siteId: string | null;
  departmentId: string;
  authorId: string | null;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
  /** 체험판 전용: 파일 내용 */
  dataUrl?: string;
}

export interface NewAttachmentInput {
  weekId: WeekId;
  kind: EntryKind;
  siteId: string | null;
  departmentId: string;
  authorId: string | null;
  file: File;
}

export interface StorageUsage {
  photoCount: number;
  photoBytes: number;
  fileCount: number;
  fileBytes: number;
  /** 크기 기록이 없는 옛 사진이 있어 일부 어림값 */
  estimated: boolean;
}

export interface AiSummary {
  weekId: WeekId;
  highlights: string[];
  siteChanges: { siteId: string; change: string }[];
  generatedAt: string;
  /** 요약을 만든 모델 */
  model: string;
  /** 요약할 때 반영된 가장 늦은 수정 시각 */
  sourceUpdatedAt: string;
}

export interface AppSettings {
  summaryModel: string;
  /** 레이어스 시스템 주소 (대표님 화면의 레이어스 버튼) */
  layersUrl?: string;
}

export interface Seed {
  reportDate: WeekId;
  departments: Department[];
  members: Member[];
  sites: Site[];
  stages?: StageDef[];
  grants: Grant[];
  entries: Entry[];
  directives: Directive[];
  comments: Comment[];
  photos?: Photo[];
  attachments?: Attachment[];
  daily?: DailyReport[];
  dailyComments?: DailyComment[];
  events?: CalendarEvent[];
  dayStatus?: DayStatus[];
}

/** 화면 하나를 그리는 데 필요한 데이터. 권한에 따라 이미 걸러진 상태 */
export interface Snapshot {
  weekId: WeekId;
  departments: Department[];
  members: Member[];
  sites: Site[];
  stages: StageDef[];
  siteFields: SiteField[];
  grants: Grant[];
  entries: Entry[];
  directives: Directive[];
  comments: Comment[];
  photos: Photo[];
  attachments: Attachment[];
  siteStatus: SiteReportStatus[];
  /** 같은 범위의 직전 주차 기록 (참고용) */
  prevWeekId: WeekId | null;
  prevEntries: Entry[];
  prevDirectives: Directive[];
}

export interface SaveEntryInput {
  weekId: WeekId;
  kind: EntryKind;
  siteId: string | null;
  departmentId: string;
  authorId: string | null;
  content: string;
}

export interface SaveDirectiveInput {
  weekId: WeekId;
  targetKind: DirectiveTarget;
  siteId: string | null;
  memberId: string | null;
  slot: MiscSlot | null;
  content: string;
}

export interface NewMemberInput {
  username: string;
  password: string;
  name: string;
  title: string;
  departmentId: string | null;
  isAdmin: boolean;
  isCeo: boolean;
  isExecutive: boolean;
  affiliation: Affiliation;
  homeSiteId: string | null;
  dailyEnabled: boolean;
}

/** 대표님 검색·AI 질문에 쓰는 보고 한 칸 */
export interface SearchDoc {
  id: string;
  kind: 'weekly' | 'daily' | 'directive';
  /** 주간·지시는 보고일(월요일), 일일은 그날 */
  date: string;
  siteId: string | null;
  departmentId: string | null;
  /** 개인 보고(부서 업무보고·일일보고·개인 지시)의 사람 */
  memberId: string | null;
  content: string;
  /** 지시사항 처리 상태 */
  status?: DirectiveStatus;
}

export interface AskAnswer {
  answer: string;
  sourceIds: string[];
  model: string;
}
