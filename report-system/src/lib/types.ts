export type Stage = 'construction' | 'cm' | 'sales';

export const STAGES: { id: Stage; label: string; short: string }[] = [
  { id: 'construction', label: '공사진행현장', short: '공사진행' },
  { id: 'cm', label: 'CM진행현장', short: 'CM' },
  { id: 'sales', label: '영업현장', short: '영업' },
];

export const SITE_TAGS = ['잔금대기', '설계변경', '금융진행', '하자', '협력업체 선정', '소송·분쟁', '착공준비', '준공임박'] as const;

export interface Department {
  id: string;
  name: string;
  sort: number;
  /** 현장별 표에 칸을 가지는 부서 (공무, 인테리어/디자인, CM, 견적) */
  writesSites: boolean;
  active: boolean;
}

export interface Member {
  id: string;
  username: string;
  name: string;
  title: string;
  departmentId: string | null;
  isCeo: boolean;
  isAdmin: boolean;
  active: boolean;
  mustChangePassword: boolean;
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
}

export interface Comment {
  id: string;
  entryId: string;
  authorId: string;
  content: string;
  createdAt: string;
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

export interface AiSummary {
  weekId: WeekId;
  highlights: string[];
  siteChanges: { siteId: string; change: string }[];
  generatedAt: string;
  /** 요약할 때 반영된 가장 늦은 수정 시각 */
  sourceUpdatedAt: string;
}

export interface Seed {
  reportDate: WeekId;
  departments: Department[];
  members: Member[];
  sites: Site[];
  grants: Grant[];
  entries: Entry[];
  directives: Directive[];
  comments: Comment[];
  photos?: Photo[];
}

/** 화면 하나를 그리는 데 필요한 데이터. 권한에 따라 이미 걸러진 상태 */
export interface Snapshot {
  weekId: WeekId;
  departments: Department[];
  members: Member[];
  sites: Site[];
  grants: Grant[];
  entries: Entry[];
  directives: Directive[];
  comments: Comment[];
  photos: Photo[];
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
}
