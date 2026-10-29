import { LogIn } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '../components/AppShell';
import { Button, Field, Input } from '../components/ui';
import { api } from '../lib/client';
import { DEMO_DEFAULT_PASSWORD } from '../lib/demoApi';
import type { Member } from '../lib/types';

export function Login({ onSignedIn }: { onSignedIn(m: Member): void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api.signIn(username, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const demoPick = api.demo?.accounts().filter((m, i, all) => m.isCeo || (m.isAdmin && !m.departmentId)
    || all.findIndex((x) => x.departmentId && x.departmentId === m.departmentId) === i).slice(0, 8);

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-9 flex flex-col items-center text-center">
          <Logo size={112} />
          <p className="mt-5 text-[13px] font-semibold tracking-[0.12em] text-ink-3">사닥다리종합건설</p>
          <h1 className="mt-1 text-[24px] font-bold tracking-[-0.025em]">주간보고</h1>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-7 shadow-card">
          <p className="text-[13.5px] text-ink-2">관리자에게 받은 아이디로 로그인하세요</p>
          <Field label="아이디"><Input id="login-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus /></Field>
          <Field label="비밀번호"><Input id="login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger" role="alert">{error}</p>}
          <Button tone="primary" type="submit" className="!h-11 w-full" disabled={busy || !username || !password}><LogIn size={16} />로그인</Button>
          <p className="text-center text-[12px] text-ink-3">비밀번호를 잊었다면 관리자에게 초기화를 요청하세요</p>
          <p className="text-center text-[12.5px]"><a href={`${import.meta.env.BASE_URL}guide/`} target="_blank" rel="noopener" className="font-semibold text-brand-ink hover:underline">처음 쓰시나요? 사용 설명서 보기</a></p>
        </form>
        {demoPick && (
          <div className="mt-6 rounded-2xl border border-note-line bg-note p-4">
            <p className="text-[13px] font-bold text-note-ink">체험판 계정 (비밀번호 {DEMO_DEFAULT_PASSWORD})</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {demoPick.map((m) => (
                <button key={m.id} onClick={async () => onSignedIn(await api.demo!.signInAs(m.id))}
                  className="rounded-full border border-note-line bg-surface px-3 py-1 text-[12.5px] font-semibold text-ink hover:border-brand">
                  {m.isCeo ? '대표님' : m.isAdmin && !m.departmentId ? '관리자' : m.name} <span className="text-ink-3">{m.username}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChangePassword({ member, onDone }: { member: Member; onDone(): void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = pw.length >= 6 && pw === pw2;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try { await api.changePassword(pw); onDone(); } catch (err) { setError(err instanceof Error ? err.message : '바꾸지 못했습니다.'); } finally { setBusy(false); }
        }}
        className="w-full max-w-[380px] space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
      >
        <div>
          <h1 className="text-[19px] font-extrabold">{member.name}님, 환영합니다</h1>
          <p className="mt-1 text-[13.5px] text-ink-3">처음 로그인하셨습니다. 앞으로 쓸 비밀번호를 정해주세요.</p>
        </div>
        <Field label="새 비밀번호" hint="6자 이상"><Input id="new-password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus /></Field>
        <Field label="새 비밀번호 확인"><Input id="new-password-2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        {pw2 && pw !== pw2 && <p className="text-[13px] text-danger">두 비밀번호가 다릅니다.</p>}
        {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}
        <Button tone="primary" type="submit" className="!h-11 w-full" disabled={!valid || busy}>비밀번호 정하고 시작하기</Button>
      </form>
    </div>
  );
}
