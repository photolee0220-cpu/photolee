import { useCallback, useEffect, useState } from 'react';
import { AppShell, DemoBar, Toasts } from './components/AppShell';
import { DrawerHost } from './components/Drawers';
import { Spinner } from './components/ui';
import { api, missingServerConfig } from './lib/client';
import type { Member } from './lib/types';
import { AdminPage } from './pages/admin/AdminPage';
import { Dashboard } from './pages/Dashboard';
import { HistoryPage } from './pages/History';
import { ChangePassword, Login } from './pages/Login';
import { MyReport } from './pages/MyReport';
import { MyWeek } from './pages/MyWeek';
import { People } from './pages/People';
import { Shared } from './pages/Shared';
import { TableView } from './pages/TableView';
import { StoreProvider, useStore } from './state/store';

const LOGGED_OUT = 'sadakdari-demo-logged-out';

export default function App() {
  const [me, setMe] = useState<Member | null | undefined>(undefined);

  useEffect(() => {
    (async () => {
      let m = await api.getSession();
      // 체험판은 처음 열면 바로 대표님 화면을 보여준다
      if (!m && api.demo && !safeSession(LOGGED_OUT)) {
        const ceo = api.demo.accounts().find((x) => x.isCeo);
        if (ceo) m = await api.demo.signInAs(ceo.id);
      }
      setMe(m);
    })();
  }, []);

  const onSignOut = useCallback(() => { safeSession(LOGGED_OUT, '1'); setMe(null); }, []);
  const onSwitch = useCallback((m: Member) => setMe(m), []);

  if (missingServerConfig) return <ServerNotConnected />;
  if (me === undefined) return <div className="flex min-h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  if (!me) return <Login onSignedIn={setMe} />;
  if (me.mustChangePassword) return <ChangePassword member={me} onDone={() => setMe({ ...me, mustChangePassword: false })} />;

  return (
    <StoreProvider key={me.id} me={me} onSignOut={onSignOut} onSwitch={onSwitch}>
      <Routes />
    </StoreProvider>
  );
}

function Routes() {
  const { view, me } = useStore();
  if (view === 'admin' && me.isAdmin) {
    return <>{api.mode === 'demo' && <DemoBar />}<AdminPage /><Toasts /></>;
  }
  return (
    <AppShell>
      {view === 'dashboard' && <Dashboard />}
      {view === 'table' && <TableView />}
      {view === 'people' && <People />}
      {view === 'mine' && <MyWeek />}
      {view === 'shared' && <Shared />}
      {view === 'report' && <MyReport />}
      {view === 'history' && <HistoryPage />}
      <DrawerHost />
    </AppShell>
  );
}

function safeSession(key: string, value?: string): string | null {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function ServerNotConnected() {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="max-w-[420px] rounded-2xl border border-line bg-surface p-6 text-center shadow-card">
        <h1 className="text-[19px] font-extrabold">서버 연결 전입니다</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
          사닥다리 주간보고 서버 연결 정보가 아직 입력되지 않았습니다. 관리자가 연결을 마치면 이 주소에서 바로 로그인할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
