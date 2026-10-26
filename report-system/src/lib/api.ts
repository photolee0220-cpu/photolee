import type {
  Comment, Department, Directive, Entry, Grant, Member, NewMemberInput, SaveDirectiveInput, SaveEntryInput, Site, Snapshot, WeekId,
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
  /** 다른 사람이 바꾼 내용이 생기면 호출된다 */
  subscribe(onChange: () => void): () => void;

  admin: {
    saveSite(site: Site): Promise<Site>;
    saveDepartment(d: Department): Promise<Department>;
    deleteDepartment(id: string): Promise<void>;
    setGrants(viewerDepartmentId: string, targetIds: string[]): Promise<Grant[]>;
    createMember(input: NewMemberInput): Promise<Member>;
    updateMember(m: Member): Promise<Member>;
    resetPassword(memberId: string, password: string): Promise<void>;
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
