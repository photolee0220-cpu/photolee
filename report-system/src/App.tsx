import { useCallback, useEffect, useState } from 'react';
import { AppShell, DemoBar, Toasts } from './components/AppShell';
import { DrawerHost } from './components/Drawers';
import { Spinner } from './components/ui';
import { api } from './lib/client';
import type { Member } from './lib/types';
import { AdminPage } from './pages/admin/AdminPage';
import { Dashboard } from './pages/Dashboard';
import { HistoryPage } from './pages/History';
import { ChangePassword, Login } from './pages/Login';
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
