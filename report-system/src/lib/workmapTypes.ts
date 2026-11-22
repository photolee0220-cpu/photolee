import type { Member, WeekId } from './types';

/** 업무 분석: 부서별 일일보고·주간 부서보고를 매주 AI가 정리한다. 찐관리자(admin 계정)만 본다 */

export const OWNER_USERNAME = 'admin';
export const isOwner = (m: Pick<Member, 'username' | 'isAdmin'> | null | undefined) => !!m && m.isAdmin && m.username === OWNER_USERNAME;

/** AI가 대신 / 도와줌 / 사람이 해야 함 */
export type IdeaLevel = 'replace' | 'assist' | 'human';
export type Grade = 'low' | 'mid' | 'high';

export const LEVEL_LABEL: Record<IdeaLevel, string> = { replace: 'AI가 대신', assist: 'AI가 도움', human: '사람이 해야 함' };
export const GRADE_LABEL: Record<Grade, string> = { low: '낮음', mid: '보통', high: '높음' };

export interface WorkCategory { name: string; count: number; examples: string[] }
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
}

export type IdeaStatus = 'idea' | 'review' | 'pilot' | 'done' | 'hold';
export const IDEA_STATUS: { id: IdeaStatus; label: string }[] = [
  { id: 'idea', label: '후보' }, { id: 'review', label: '검토 중' }, { id: 'pilot', label: '시범 적용' }, { id: 'done', label: '적용 완료' }, { id: 'hold', label: '보류' },
];

/** 개선 목록에 담은 것 */
export interface WorkIdea {
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
  /** 저장된 분석 전부 (최근 것부터). 처음이면 최근 4주를 바로 만든다 */
  list(): Promise<WorkAnalysis[]>;
  /** 그 주를 (다시) 분석한다 */
  generate(weekId: WeekId): Promise<WorkAnalysis[]>;
  ideas(): Promise<WorkIdea[]>;
  saveIdea(i: WorkIdea): Promise<WorkIdea>;
  removeIdea(id: string): Promise<void>;
}

/** 우선순위 점수: 자주 나오고, AI로 바꾸기 쉽고, 효과가 큰 것 */
export const ideaScore = (i: Pick<WorkIdeaSuggestion, 'level' | 'effort' | 'impact'>, times: number) =>
  i.level === 'human' ? 0 : Math.max(1, times) * (i.level === 'replace' ? 2 : 1) * ({ low: 3, mid: 2, high: 1 }[i.effort]) * ({ low: 1, mid: 2, high: 3 }[i.impact]);
