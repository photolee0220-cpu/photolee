import type { Affiliation, CalendarEvent, Department, Directive, Entry, Grant, Member, WeekId } from './types';
import { currentWeekId, dowOf, todayIso } from './week';

/** 서버(Supabase RLS)와 같은 규칙. 데모 모드와 화면 표시에서 사용 */

export function canSeeAll(me: Member): boolean {
  return me.isCeo || me.isAdmin || me.isExecutive;
}

/** 보고를 쓰지 않고 검토하며 코멘트를 남기는 사람 (대표, 본부장). 이들의 코멘트는 담당자가 확인해야 한다 */
export function isReviewer(m: Pick<Member, 'isCeo' | 'isExecutive'> | undefined | null): boolean {
  return !!m && (m.isCeo || m.isExecutive);
}

export function viewableDepartmentIds(me: Member, grants: Grant[]): Set<string> | 'all' {
  if (canSeeAll(me)) return 'all';
  const ids = new Set<string>();
  if (me.departmentId) {
    ids.add(me.departmentId);
    for (const g of grants) if (g.viewerDepartmentId === me.departmentId) ids.add(g.targetDepartmentId);
  }
  return ids;
}

export function canViewDept(me: Member, deptId: string | null, grants: Grant[]): boolean {
  if (!deptId) return canSeeAll(me);
  const v = viewableDepartmentIds(me, grants);
  return v === 'all' || v.has(deptId);
}

export function canEditEntry(me: Member, e: Pick<Entry, 'kind' | 'departmentId' | 'authorId'>): boolean {
  if (me.isAdmin) return true;
  if (e.kind === 'dept') return e.authorId === me.id;
  return !!me.departmentId && me.departmentId === e.departmentId;
}

export function canViewDirective(me: Member, d: Directive, members: Member[], grants: Grant[]): boolean {
  if (canSeeAll(me)) return true;
  if (d.targetKind === 'site') return true;
  if (d.targetKind === 'misc') return d.slot === 'special';
  const target = members.find((m) => m.id === d.memberId);
  return canViewDept(me, target?.departmentId ?? null, grants);
}

/** 회계 현황은 대표와 회계팀만 */
export function canViewFinance(me: Member, deptName: string | undefined): boolean {
  return me.isCeo || deptName === '회계';
}

/** 지난 주차는 관리자만 고친다 (보기는 누구나 권한대로). 서버 guard_past_week와 같은 규칙 */
export function isWeekLocked(me: Member, weekId: WeekId): boolean {
  return !me.isAdmin && weekId < currentWeekId();
}

/** 지시사항 처리 상태를 바꿀 수 있는 사람: 담당자(개인 지시는 본인, 현장 지시는 현장 칸 쓰는 부서원)·대표·관리자 */
export function canSetDirectiveStatus(me: Member, d: Directive, writesSites: boolean): boolean {
  if (me.isCeo || me.isAdmin) return true;
  if (d.targetKind === 'member') return d.memberId === me.id;
  return d.targetKind === 'site' && writesSites;
}

/** 일일보고를 쓰는 사람: 부서가 있고 대표·본부장이 아니며 관리자가 끄지 않은 사람 */
export function writesDaily(m: Member): boolean {
  return m.active && !!m.departmentId && !m.isCeo && !m.isExecutive && m.dailyEnabled !== false;
}

export function affiliationOf(m: Pick<Member, 'affiliation'>): Affiliation {
  return m.affiliation ?? 'hq';
}

/** 일일보고를 꼭 써야 하는 날: 월~금 (토요일은 쓴 사람만 표시) */
export function isWorkday(date: string): boolean {
  const d = dowOf(date);
  return d >= 1 && d <= 5;
}

/** 부서 안 보고 부서의 부서원 (부서장 제외): 대표님이 아니라 부서장에게 일일보고만 쓴다 */
export function isInternalMember(m: Pick<Member, 'id' | 'departmentId'>, departments: Department[]): boolean {
  const d = departments.find((x) => x.id === m.departmentId);
  return !!d?.internalReport && d.headId !== m.id;
}

/** 주간보고를 쓰는 사람: 부서원(부서 안 보고)과 현장 직원은 일일보고만 쓴다 */
export function writesWeekly(m: Member, departments: Department[]): boolean {
  return m.active && !!m.departmentId && !m.isCeo && !m.isExecutive && affiliationOf(m) !== 'site' && !isInternalMember(m, departments);
}

/** 내가 부서장인 '부서 안 보고' 부서 */
export function headedDepartments(me: Member, departments: Department[]): Department[] {
  return departments.filter((d) => d.active && d.internalReport && d.headId === me.id);
}

/** 이 사람의 일일보고에 피드백(확인 요청)을 남길 수 있는 사람: 부서원은 부서장, 그 밖에는 대표·본부장 */
export function canReviewDaily(me: Member, target: Member, departments: Department[]): boolean {
  if (me.id === target.id) return false;
  if (isInternalMember(target, departments)) return departments.some((d) => d.id === target.departmentId && d.headId === me.id);
  return isReviewer(me);
}

/** 근무 상태 등록: 본인, 관리자, 그 사람 부서의 부서장 */
export function canSetDayStatus(me: Member, target: Member, departments: Department[]): boolean {
  if (me.isAdmin || me.id === target.id) return true;
  return departments.some((d) => d.id === target.departmentId && d.headId === me.id);
}

/** 일일보고는 본인이 당일에만 고친다 (관리자는 언제나). 서버 규칙과 같다 */
export function canEditDaily(me: Member, authorId: string, date: string): boolean {
  if (me.isAdmin) return true;
  return authorId === me.id && date === todayIso();
}

export function canSeeEvent(me: Member, e: CalendarEvent, grants: Grant[]): boolean {
  if (e.scope === 'all' || e.createdBy === me.id) return true;
  return canViewDept(me, e.departmentId, grants);
}

export function canEditEvent(me: Member, e: Pick<CalendarEvent, 'createdBy'>): boolean {
  return me.isAdmin || e.createdBy === me.id;
}
