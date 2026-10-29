import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/client';
import type { Comment, Directive, DirectiveStatus, Entry, Member, SaveDirectiveInput, SaveEntryInput, Snapshot, WeekId } from '../lib/types';
import { currentWeekId } from '../lib/week';

export type DiffMode = 'off' | 'highlight' | 'only';
export type View = 'dashboard' | 'table' | 'people' | 'mine' | 'report' | 'shared' | 'history' | 'admin';
export type Drawer = { type: 'site'; id: string } | { type: 'person'; id: string } | { type: 'writers' } | { type: 'feedback' } | { type: 'directives' } | null;
type Toast = { id: number; text: string; tone: 'ok' | 'error' };

interface Store {
  me: Member;
  snap: Snapshot | null;
  weekId: WeekId;
  setWeekId(w: WeekId): void;
  loading: boolean;
  reload(): Promise<void>;
  view: View;
  setView(v: View): void;
  drawer: Drawer;
  openDrawer(d: Drawer): void;
  searchOpen: boolean;
  diffMode: DiffMode;
  setDiffMode(m: DiffMode): void;
  setSearchOpen(v: boolean): void;
  toast(text: string, tone?: 'ok' | 'error'): void;
  toasts: Toast[];
  saveEntry(i: SaveEntryInput): Promise<Entry>;
  saveDirective(i: SaveDirectiveInput): Promise<Directive>;
  setDirectiveStatus(id: string, status: DirectiveStatus): Promise<void>;
  addComment(entryId: string, content: string): Promise<Comment>;
  acknowledge(id: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
  signOut(): Promise<void>;
  switchAccount(m: Member): void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

export function defaultView(m: Member): View {
  if (m.isCeo || m.isExecutive) return 'dashboard';
  if (m.departmentId) return 'mine';
  return 'dashboard';
}

export function StoreProvider({ me, onSignOut, onSwitch, children }: {
  me: Member; onSignOut(): void; onSwitch(m: Member): void; children: ReactNode;
}) {
  const [weekId, setWeekIdState] = useState<WeekId>(currentWeekId());
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(defaultView(me));
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [diffMode, setDiffModeState] = useState<DiffMode>(() => {
    try { return (localStorage.getItem('report-diff-mode') as DiffMode | null) ?? 'highlight'; } catch { return 'highlight'; }
  });
  const setDiffMode = useCallback((m: DiffMode) => {
    setDiffModeState(m);
    try { localStorage.setItem('report-diff-mode', m); } catch { /* 저장 못 해도 화면은 바뀐다 */ }
  }, []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const weekRef = useRef(weekId);
  weekRef.current = weekId;

  const toast = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const load = useCallback(async (w: WeekId, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const s = await api.loadWeek(w);
      if (weekRef.current === w) setSnap(s);
    } catch (e) {
      toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  // 체험판은 데이터가 있는 가장 최근 주차부터 보여준다
  useEffect(() => {
    let alive = true;
    (async () => {
      let w = currentWeekId();
      if (api.mode === 'demo') {
        const weeks = await api.listWeeks();
        if (!weeks.some((x) => x.weekId === w && x.entryCount > 0) && weeks[0]) w = weeks[0].weekId;
      }
      if (alive) { setWeekIdState(w); weekRef.current = w; load(w); }
    })();
    return () => { alive = false; };
  }, [load]);

  useEffect(() => api.subscribe(() => load(weekRef.current, true)), [load]);

  const setWeekId = useCallback((w: WeekId) => {
    setWeekIdState(w);
    weekRef.current = w;
    load(w);
  }, [load]);

  const merge = useCallback(<K extends 'entries' | 'directives' | 'comments'>(key: K, item: Snapshot[K][number]) => {
    setSnap((s) => {
      if (!s) return s;
      const list = s[key] as { id: string }[];
      const next = list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
      return { ...s, [key]: next };
    });
  }, []);

  const value = useMemo<Store>(() => ({
    me, snap, weekId, setWeekId, loading, reload: () => load(weekRef.current, true),
    view, setView: (v) => { setView(v); setDrawer(null); },
    drawer, openDrawer: setDrawer, searchOpen, setSearchOpen, diffMode, setDiffMode, toast, toasts,
    async saveEntry(i) { const e = await api.saveEntry(i); merge('entries', e); return e; },
    async saveDirective(i) { const d = await api.saveDirective(i); merge('directives', d); return d; },
    async setDirectiveStatus(id, status) {
      const d = await api.setDirectiveStatus(id, status);
      setSnap((s) => s && { ...s, directives: s.directives.map((x) => (x.id === d.id ? d : x)), prevDirectives: s.prevDirectives.map((x) => (x.id === d.id ? d : x)) });
    },
    async addComment(entryId, content) { const c = await api.addComment(entryId, content); merge('comments', c); return c; },
    async acknowledge(id) {
      await api.acknowledgeComment(id);
      setSnap((s) => s && { ...s, comments: s.comments.map((c) => (c.id === id ? { ...c, acknowledgedAt: new Date().toISOString(), acknowledgedBy: me.id } : c)) });
    },
    async deleteComment(id) {
      await api.deleteComment(id);
      setSnap((s) => s && { ...s, comments: s.comments.filter((c) => c.id !== id) });
    },
    async signOut() { await api.signOut(); onSignOut(); },
    switchAccount: onSwitch,
  }), [me, snap, weekId, setWeekId, loading, load, view, drawer, searchOpen, diffMode, setDiffMode, toast, toasts, merge, onSignOut, onSwitch]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
