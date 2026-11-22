import type { Member, WeekId } from './types';

/** 업무 분석: 부서별 일일보고·주간 부서보고를 매주 AI가 정리한다. 찐관리자(admin 계정)만 본다 */

export const OWNER_USERNAME = 'admin';
export const isOwner = (m: Pick<Member, 'username' | 'isAdmin'> | null | undefined) => !!m && m.isAdmin && m.username === OWNER_USERNAME;

/** AI가 대신 / 도와줌 / 사람이 해야 함 */
export type IdeaLevel = 'replace' | 'assist' | 'human';
export type Grade = 'low' | 'mid' | 'high';

export const LEVEL_LABEL: Record<IdeaLevel, string> = { replace: 'AI가 대신', assist: 'AI가 도움', human: '사람이 해야 함' };
export const GRADE_LABEL: Record<Grade, string> = { low: '낮음', mid: '보통', high: '높음' };

export interface WorkCategory { name: string; count: number; examples: string[]; /** 시간 비중 % */ share?: number }
/** 업무 목록 한 줄 (컨설팅 분석) */
export interface WorkTask {
  task: string; category: string; times: number;
  /** 보고 원문 인용 */
  evidence: string;
  tools: string[]; output: string;
  /** 주간 소요 시간 추정 */
  hoursPerWeek: number;
  replaceability: 'full' | 'partial' | 'human';
  /** AI 대체 가능도 0~100 */
  score: number;
  reason: string;
}
export interface WorkIssue { finding: string; evidence: string; impact: string }
export type IdeaApproach = 'system' | 'external' | 'process';
export const APPROACH_LABEL: Record<IdeaApproach, string> = { system: '시스템 기능 개발', external: '외부 AI 도구', process: '업무 방식 개선' };
export const REPLACE_LABEL = { full: 'AI 대체 가능', partial: '일부 대체', human: '사람이 해야 함' } as const;
export interface RecurringTask { task: string; times: number; note: string }
export interface WorkIdeaSuggestion {
  task: string;
  level: IdeaLevel;
  /** 어떻게 쓰면 되는지 */
  how: string;
  /** 이 시스템에 붙인다면 */
  system: string;
  /** 만들기 어려움 */
  effort: Grade;
  /** 효과 */
  impact: Grade;
  /* 아래는 컨설팅 분석(Opus)에서 채워진다 */
  title?: string;
  approach?: IdeaApproach;
  asIs?: string;
  toBe?: string;
  /** 외부 도구일 때 그대로 쓰는 프롬프트 */
  toolPrompt?: string;
  steps?: string[];
  /** 주간 절감 시간 */
  hoursSaved?: number;
  savingsBasis?: string;
  errorReduction?: string;
  risks?: string;
  kpi?: string;
}

export interface WorkAnalysis {
  weekId: WeekId;
  departmentId: string;
  /** 분석에 쓴 보고 수 (일일보고 + 주간 부서보고) */
  reportCount: number;
  summary: string;
  categories: WorkCategory[];
  recurring: RecurringTask[];
  ideas: WorkIdeaSuggestion[];
  createdAt: string;
  /* 컨설팅 분석 */
  replaceRate?: number;
  hoursObserved?: number;
  hoursSavable?: number;
  tasks?: WorkTask[];
  issues?: WorkIssue[];
  humanTasks?: { task: string; reason: string }[];
  ceoPoints?: string[];
  questions?: string[];
  model?: string;
}

/** 한 주 분석 진행 상태 */
export interface WorkRun { weekId: WeekId; status: 'running' | 'done' | 'error'; total: number; done: number; error: string | null; startedAt: string }

export type IdeaStatus = 'idea' | 'review' | 'pilot' | 'done' | 'hold';
export const IDEA_STATUS: { id: IdeaStatus; label: string }[] = [
  { id: 'idea', label: '후보' }, { id: 'review', label: '검토 중' }, { id: 'pilot', label: '시범 적용' }, { id: 'done', label: '적용 완료' }, { id: 'hold', label: '보류' },
];

/** 개선 목록에 담은 것 */
export interface WorkIdea extends Partial<Pick<WorkIdeaSuggestion, 'title' | 'approach' | 'asIs' | 'toBe' | 'toolPrompt' | 'steps' | 'hoursSaved' | 'savingsBasis' | 'errorReduction' | 'risks' | 'kpi'>> {
  id: string;
  departmentId: string;
  task: string;
  level: IdeaLevel;
  how: string;
  system: string;
  effort: Grade;
  impact: Grade;
  status: IdeaStatus;
  note: string;
  /** 어느 주 분석에서 담았나 */
  weekId: WeekId;
  createdAt: string;
  updatedAt: string;
}

export interface WorkmapApi {
  /** 저장된 분석 전부 (최근 것부터) */
  list(): Promise<WorkAnalysis[]>;
  /** 최근 4주 중 아직 분석하지 않은 주를 분석 시작 */
  ensureRecent(): Promise<void>;
  /** 그 주를 (다시) 분석 시작. 결과는 뒤에서 만들어진다 */
  generate(weekId: WeekId): Promise<void>;
  /** 진행 상태 (진행 중이면 결과를 모으러 간다) */
  runs(): Promise<WorkRun[]>;
  ideas(): Promise<WorkIdea[]>;
  saveIdea(i: WorkIdea): Promise<WorkIdea>;
  removeIdea(id: string): Promise<void>;
}

/** 우선순위 점수: 자주 나오고, AI로 바꾸기 쉽고, 효과가 큰 것 */
export const ideaScore = (i: Pick<WorkIdeaSuggestion, 'level' | 'effort' | 'impact' | 'hoursSaved'>, times: number) =>
  i.level === 'human' ? 0 : Math.max(1, i.hoursSaved ?? times) * (i.level === 'replace' ? 2 : 1) * ({ low: 3, mid: 2, high: 1 }[i.effort]) * ({ low: 1, mid: 2, high: 3 }[i.impact]);
