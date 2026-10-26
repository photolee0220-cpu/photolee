import {
  CalendarRange, ChevronLeft, ChevronRight, History, LayoutDashboard, LogOut, Moon, PenLine, Search, Settings, Sun, Table2, Users, Eye,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/client';
import { byId, has, personEntry } from '../lib/derive';
import { STAGES } from '../lib/types';
import { currentWeekId, deadlineText, shiftWeek, weekLabel } from '../lib/week';
import { useStore, type View } from '../state/store';
import { Avatar, Badge, cx, IconButton } from './ui';

type NavItem = { id: View; label: string; icon: ReactNode };

export function navItems(me: ReturnType<typeof useStore>['me'], hasShared: boolean): NavItem[] {
  const items: NavItem[] = [];
  if (me.departmentId && !me.isCeo) items.push({ id: 'mine', label: '이번 주 작성', icon: <PenLine size={18} /> });
  if (me.isCeo || me.isAdmin) {
    items.push({ id: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={18} /> });
    items.push({ id: 'table', label: '표 보기', icon: <Table2 size={18} /> });
    items.push({ id: 'people', label: '부서 보고', icon: <Users size={18} /> });
  }
  if (hasShared && !me.isCeo && !me.isAdmin) items.push({ id: 'shared', label: '함께 보는 부서', icon: <Eye size={18} /> });
  items.push({ id: 'history', label: '지난 보고', icon: <History size={18} /> });
  return items;
}

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try { return (localStorage.getItem('report-theme') as 'light' | 'dark' | null) ?? null; } catch { return null; }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { if (theme) localStorage.setItem('report-theme', theme); else localStorage.removeItem('report-theme'); } catch { /* 무시 */ }
  }, [theme]);
  const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  return { isDark, toggle: () => setTheme(isDark ? 'light' : 'dark') };
}

export function WeekSwitcher({ className }: { className?: string }) {
  const { weekId, setWeekId } = useStore();
  const cur = currentWeekId();
  return (
    <div className={cx('flex items-center gap-1', className)}>
      <IconButton label="이전 주" onClick={() => setWeekId(shiftWeek(weekId, -1))}><ChevronLeft size={18} /></IconButton>
      <span className="min-w-[96px] text-center text-[14px] font-bold tabular">{weekLabel(weekId)}</span>
      <IconButton label="다음 주" onClick={() => setWeekId(shiftWeek(weekId, 1))} disabled={weekId >= cur} className="disabled:opacity-30">
        <ChevronRight size={18} />
      </IconButton>
      {weekId !== cur && (
        <button onClick={() => setWeekId(cur)} className="ml-1 rounded-md bg-brand-soft px-2 py-1 text-[12px] font-bold text-brand-ink">이번 주</button>
      )}
    </div>
  );
}

export function DeadlineBadge() {
  const { weekId } = useStore();
  const d = deadlineText(weekId);
  return <Badge tone={d.tone === 'soon' ? 'warn' : d.tone === 'over' ? 'neutral' : 'brand'} className="!py-1"><CalendarRange size={12} />{d.text}</Badge>;
}

export function DemoBar() {
  const { me, switchAccount, reload } = useStore();
  const accounts = api.demo!.accounts();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-note-line bg-note px-4 py-2 text-[13px] text-note-ink">
      <span className="font-bold">체험판</span>
      <span className="hidden sm:inline">계정을 바꿔가며 대표님·관리자·직원 화면을 확인해 보세요. 입력한 내용은 이 브라우저에만 저장됩니다.</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">보는 계정</span>
        <select
          value={me.id}
          onChange={async (e) => switchAccount(await api.demo!.signInAs(e.target.value))}
          className="h-8 rounded-md border border-note-line bg-surface px-2 text-[13px] font-semibold text-ink"
        >
          {accounts.map((m) => (
            <option key={m.id} value={m.id}>
              {m.isCeo ? '대표님' : m.isAdmin && !m.departmentId ? '관리자 (취합 담당)' : `${m.name} ${m.title}`}
            </option>
          ))}
        </select>
      </label>
      <button className="ml-auto font-semibold underline-offset-2 hover:underline" onClick={() => { api.demo!.reset(); void reload(); }}>처음 상태로</button>
    </div>
  );
}

function SearchPalette() {
  const { snap, me, searchOpen, setSearchOpen, openDrawer, setView } = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(!searchOpen); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [searchOpen, setSearchOpen]);

  const results = useMemo(() => {
    if (!snap) return [];
    const depts = byId(snap.departments);
    const term = q.trim();
    const match = (s: string) => !term || s.includes(term);
    const sites = snap.sites.filter((s) => !s.archived && (match(s.name) || match(s.note))).map((s) => ({
      key: s.id, label: s.name, sub: `${STAGES.find((x) => x.id === s.stage)!.short} · ${s.process || s.note}`,
      run: () => openDrawer({ type: 'site', id: s.id }),
    }));
    const people = snap.members.filter((m) => m.active && m.departmentId && !m.isCeo && (match(m.name) || match(depts.get(m.departmentId)?.name ?? '')))
      .filter((m) => me.isCeo || me.isAdmin || m.departmentId === me.departmentId || has(personEntry(snap.entries, m.id)?.content))
      .map((m) => ({ key: m.id, label: `${m.name} ${m.title}`, sub: depts.get(m.departmentId!)?.name ?? '', run: () => openDrawer({ type: 'person', id: m.id }) }));
    const misc = match('기타사항') ? [{ key: 'misc', label: '기타사항', sub: '대표 진행사항, 특별 지시, 부서 기타', run: () => openDrawer({ type: 'misc' }) }] : [];
    return [...sites, ...people, ...misc].slice(0, 12);
  }, [snap, q, me, openDrawer]);

  if (!searchOpen) return null;
  const close = () => { setSearchOpen(false); setQ(''); setSel(0); };
  const go = (i: number) => { const r = results[i]; if (!r) return; close(); if (me.departmentId && !me.isCeo) setView(me.isAdmin ? 'dashboard' : 'mine'); setTimeout(r.run, 0); };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop-in">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={18} className="text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') go(sel);
              if (e.key === 'Escape') close();
            }}
            placeholder="현장, 사람, 부서 검색"
            className="h-14 flex-1 bg-transparent text-[15px] focus:outline-none"
          />
          <kbd className="rounded border border-line px-1.5 text-[11px] text-ink-3">ESC</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-ink-3">검색 결과가 없습니다</li>}
          {results.map((r, i) => (
            <li key={r.key}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(i)}
                className={cx('flex w-full flex-col items-start rounded-lg px-3 py-2 text-left', i === sel && 'bg-sunken')}>
                <span className="font-semibold">{r.label}</span>
                <span className="text-[12px] text-ink-3">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={cx('rounded-full px-4 py-2.5 text-[13px] font-semibold shadow-pop animate-pop-in',
          t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-bg')}>{t.text}</div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, snap, view, setView, setSearchOpen, signOut } = useStore();
  const { isDark, toggle } = useTheme();
  const hasShared = !!snap?.grants.some((g) => g.viewerDepartmentId === me.departmentId);
  const items = navItems(me, hasShared);
  const dept = snap?.departments.find((d) => d.id === me.departmentId);

  return (
    <div className="flex min-h-full flex-col">
      {api.mode === 'demo' && <DemoBar />}
      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
          <div className="flex items-center gap-2.5 px-2 pb-4">
            <Logo />
            <div className="leading-tight">
              <p className="text-[15px] font-extrabold tracking-[-0.02em]">사닥다리</p>
              <p className="text-[12px] text-ink-3">주간보고</p>
            </div>
          </div>
          <button onClick={() => setSearchOpen(true)} className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 text-[13px] text-ink-3 hover:border-line-strong">
            <Search size={15} />검색<kbd className="ml-auto text-[11px]">Ctrl K</kbd>
          </button>
          <nav className="flex flex-col gap-0.5">
            {items.map((it) => (
              <button key={it.id} onClick={() => setView(it.id)}
                className={cx('flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-[14px] font-semibold transition-colors',
                  view === it.id ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-sunken hover:text-ink')}>
                {it.icon}{it.label}
              </button>
            ))}
            {me.isAdmin && (
              <button onClick={() => setView('admin')}
                className="mt-3 flex h-10 items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-2.5 text-[14px] font-semibold text-ink-2 hover:bg-sunken">
                <Settings size={18} />관리자 페이지
              </button>
            )}
          </nav>
          <div className="mt-auto space-y-1 border-t border-line pt-3">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <Avatar id={me.id} name={me.name} size={30} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13.5px] font-semibold">{me.name} {me.title}</p>
                <p className="truncate text-[12px] text-ink-3">{me.isCeo ? '대표' : dept?.name ?? (me.isAdmin ? '관리자' : '')}</p>
              </div>
            </div>
            <div className="flex gap-1 px-1">
              <IconButton label={isDark ? '밝은 화면' : '어두운 화면'} onClick={toggle}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
              <IconButton label="로그아웃" onClick={() => void signOut()}><LogOut size={17} /></IconButton>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
            <Logo small />
            <p className="flex-1 truncate text-[15px] font-bold">{items.find((i) => i.id === view)?.label ?? '관리자 페이지'}</p>
            <IconButton label="검색" onClick={() => setSearchOpen(true)}><Search size={18} /></IconButton>
            <IconButton label={isDark ? '밝은 화면' : '어두운 화면'} onClick={toggle}>{isDark ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
            {me.isAdmin && <IconButton label="관리자 페이지" onClick={() => setView('admin')}><Settings size={18} /></IconButton>}
            <IconButton label="로그아웃" onClick={() => void signOut()}><LogOut size={17} /></IconButton>
          </header>
          <main className="min-w-0 flex-1 px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7">{children}</main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {items.map((it) => (
          <button key={it.id} onClick={() => setView(it.id)}
            className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold', view === it.id ? 'text-brand-ink' : 'text-ink-3')}>
            {it.icon}{it.label}
          </button>
        ))}
      </nav>
      <SearchPalette />
      <Toasts />
    </div>
  );
}

export function Logo({ small }: { small?: boolean }) {
  const s = small ? 28 : 34;
  return (
    <svg width={s} height={s} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="112" fill="rgb(var(--brand))" />
      <g stroke="rgb(var(--on-brand))" strokeWidth="34" strokeLinecap="round">
        <path d="M188 104v304M324 104v304" />
        <path d="M188 168h136M188 256h136M188 344h136" strokeWidth="28" />
      </g>
    </svg>
  );
}

export function PageHeader({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">{title}</h1>
        {children && <div className="mt-1.5 flex flex-wrap items-center gap-2">{children}</div>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

