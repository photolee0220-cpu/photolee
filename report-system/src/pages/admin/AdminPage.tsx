import {
  ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Building2, CheckCircle2, Download, KeyRound, Pencil, Plus, ShieldCheck, Sparkles, Trash2, UserPlus, Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Logo } from '../../components/AppShell';
import { dueInfo } from '../../components/SiteCard';
import { Avatar, Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Segmented, Select, Spinner, StageChip, Toggle } from '../../components/ui';
import { newId, type WeekSummary } from '../../lib/api';
import { api } from '../../lib/client';
import { activeDepartments, isCompleted } from '../../lib/derive';
import { SUMMARY_MODELS } from '../../lib/models';
import { SITE_TAGS, STAGES, type Department, type Member, type Site, type Stage } from '../../lib/types';
import { currentWeekId, weekLabelLong } from '../../lib/week';
import { defaultView, useStore } from '../../state/store';
import { useExport } from '../useExport';

type Tab = 'sites' | 'members' | 'depts' | 'weeks' | 'ai';

export function AdminPage() {
  const { me, setView } = useStore();
  const [tab, setTab] = useState<Tab>('sites');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'sites', label: '현장 관리', icon: <Building2 size={16} /> },
    { id: 'members', label: '인원·관리자', icon: <Users size={16} /> },
    { id: 'depts', label: '부서·열람 권한', icon: <ShieldCheck size={16} /> },
    { id: 'weeks', label: '주차·내려받기', icon: <Download size={16} /> },
    { id: 'ai', label: 'AI 설정', icon: <Sparkles size={16} /> },
  ];
  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
          <Logo small />
          <p className="flex-1 text-[15px] font-extrabold">관리자 페이지</p>
          <Button size="sm" tone="ghost" onClick={() => setView(defaultView(me))}><ArrowLeft size={15} />보고 화면으로</Button>
        </div>
        <nav className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-4 sm:px-6">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cx('flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[14px] font-semibold',
                tab === t.id ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink')}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        {tab === 'sites' && <SitesAdmin />}
        {tab === 'members' && <MembersAdmin />}
        {tab === 'depts' && <DeptsAdmin />}
        {tab === 'weeks' && <WeeksAdmin />}
        {tab === 'ai' && <AiSettings />}
      </main>
    </div>
  );
}

function useRun() {
  const { toast, reload } = useStore();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : '처리하지 못했습니다.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/* ───────────── 현장 ───────────── */

function SitesAdmin() {
  const { snap } = useStore();
  const { run } = useRun();
  const [filter, setFilter] = useState<Stage | 'archived'>('construction');
  const [editing, setEditing] = useState<Site | null>(null);
  if (!snap) return <Spinner />;
  const all = [...snap.sites].sort((a, b) => a.sort - b.sort);
  const list = all.filter((s) => (filter === 'archived' ? s.archived : !s.archived && s.stage === filter));
  const count = (st: Stage) => all.filter((s) => !s.archived && s.stage === st).length;

  const move = (s: Site, dir: -1 | 1) => {
    const i = list.indexOf(s);
    const other = list[i + dir];
    if (!other) return;
    void run(async () => {
      await api.admin.saveSite({ ...s, sort: other.sort });
      await api.admin.saveSite({ ...other, sort: s.sort });
    });
  };

  const blank = (): Site => ({
    id: newId('new'), name: '', note: '', stage: filter === 'archived' ? 'sales' : filter, dueDate: null, dueText: '미정', process: '',
    progress: null, scale: '', tags: [], sort: Math.max(0, ...all.map((s) => s.sort)) + 1, archived: false, completedAt: null,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold">현장 관리</h1>
          <p className="text-[13px] text-ink-3">현장 추가, 단계 이동(영업 → CM → 공사진행), 공정율·준공일 수정, 준공 처리를 합니다. 보관한 현장의 기록은 그대로 남습니다.</p>
        </div>
        <Button tone="primary" onClick={() => setEditing(blank())}><Plus size={16} />현장 추가</Button>
      </div>
      <Segmented<Stage | 'archived'> value={filter} onChange={setFilter} className="mb-4" options={[
        ...STAGES.map((s) => ({ id: s.id as Stage | 'archived', label: `${s.short} ${count(s.id)}` })),
        { id: 'archived', label: `보관함 ${all.filter((s) => s.archived).length}` },
      ]} />
      {list.length === 0 ? <Empty title="이 단계의 현장이 없습니다" /> : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {list.map((s, i) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
              {filter !== 'archived' && (
                <div className="flex flex-col">
                  <button aria-label="위로" disabled={i === 0} onClick={() => move(s, -1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowUp size={15} /></button>
                  <button aria-label="아래로" disabled={i === list.length - 1} onClick={() => move(s, 1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowDown size={15} /></button>
                </div>
              )}
              <div className="min-w-[200px] flex-1">
                <p className="flex flex-wrap items-center gap-1.5 font-bold">{s.name}<StageChip stage={s.stage} />{s.tags.map((t) => <Badge key={t}>{t}</Badge>)}</p>
                <p className="text-[12.5px] text-ink-3">{[s.note, s.process, s.progress != null ? `${s.progress}%` : s.scale, isCompleted(s) && s.stage === 'construction' ? '' : dueInfo(s).label].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-1.5">
                {s.archived ? (
                  <Button size="sm" onClick={() => run(() => api.admin.saveSite({ ...s, archived: false }), '현장을 다시 꺼냈습니다')}><ArchiveRestore size={14} />다시 꺼내기</Button>
                ) : (
                  <>
                    {s.stage === 'construction' && !isCompleted(s) && (
                      <Button size="sm" onClick={() => run(() => api.admin.saveSite({ ...s, progress: 100, process: '준공완료', completedAt: new Date().toISOString().slice(0, 10) }), `${s.name} 준공 처리했습니다`)}>
                        <CheckCircle2 size={14} />준공 처리
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setEditing(s)}><Pencil size={14} />수정</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SiteForm site={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SiteForm({ site, onClose }: { site: Site; onClose(): void }) {
  const { run, busy } = useRun();
  const [s, set] = useState<Site>(site);
  const [customTag, setCustomTag] = useState('');
  const isNew = site.id.startsWith('new_');
  const up = <K extends keyof Site>(k: K, v: Site[K]) => set((x) => ({ ...x, [k]: v }));
  const tagOptions = [...new Set([...SITE_TAGS, ...s.tags])];

  const save = async () => {
    if (!s.name.trim()) return;
    const ok = await run(() => api.admin.saveSite({ ...s, name: s.name.trim() }), isNew ? '현장을 추가했습니다' : '저장했습니다');
    if (ok) onClose();
  };

  return (
    <Modal open onClose={onClose} title={isNew ? '현장 추가' : `${site.name} 수정`} width={600}
      footer={<>
        {!isNew && !s.archived && <Button tone="danger" className="mr-auto" onClick={async () => { if (await run(() => api.admin.saveSite({ ...s, archived: true }), '보관함으로 옮겼습니다')) onClose(); }}>보관함으로</Button>}
        <Button onClick={onClose}>취소</Button>
        <Button tone="primary" onClick={save} disabled={busy || !s.name.trim()}>저장</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="현장명"><Input id="site-name" value={s.name} onChange={(e) => up('name', e.target.value)} placeholder="예: 검단중앙교회" autoFocus /></Field></div>
        <div className="sm:col-span-2"><Field label="부가 정보" hint="설계사무소, 금융기관 등"><Input id="site-note" value={s.note} onChange={(e) => up('note', e.target.value)} placeholder="예: 아벨 · 신한은행 진행" /></Field></div>
        <Field label="단계">
          <Select id="site-stage" value={s.stage} onChange={(e) => up('stage', e.target.value as Stage)}>
            {STAGES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
        </Field>
        <Field label={s.stage === 'construction' ? '주요 진행 공정' : '주요 진행 사항'}><Input id="site-process" value={s.process} onChange={(e) => up('process', e.target.value)} placeholder="예: 철콘공사" /></Field>
        <Field label={s.stage === 'construction' ? '준공예상일' : '착공예상일'} hint="비우면 아래 표기가 쓰입니다">
          <Input id="site-due" type="date" value={s.dueDate ?? ''} onChange={(e) => up('dueDate', e.target.value || null)} />
        </Field>
        <Field label="날짜 대신 표기"><Input id="site-due-text" value={s.dueText} onChange={(e) => up('dueText', e.target.value)} placeholder="미정" /></Field>
        <Field label="공정율 (%)" hint="공정율이 없으면 비워두세요">
          <Input id="site-progress" type="number" min={0} max={100} value={s.progress ?? ''} onChange={(e) => up('progress', e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))))} />
        </Field>
        <Field label="규모·연면적" hint="공정율 대신 보일 내용"><Input id="site-scale" value={s.scale} onChange={(e) => up('scale', e.target.value)} placeholder="예: 약 2,700평, 리모델링" /></Field>
        <div className="sm:col-span-2">
          <Field label="이슈 표시" hint="대표님 대시보드 '이슈별 현장'에 묶여서 보입니다">
            <div className="flex flex-wrap gap-1.5">
              {tagOptions.map((t) => {
                const on = s.tags.includes(t);
                return (
                  <button type="button" key={t} onClick={() => up('tags', on ? s.tags.filter((x) => x !== t) : [...s.tags, t])}
                    className={cx('rounded-full border px-2.5 py-1 text-[12.5px] font-semibold', on ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-ink-2 hover:border-brand')}>
                    {t}
                  </button>
                );
              })}
              <input id="site-tag-custom" value={customTag} onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && customTag.trim()) { e.preventDefault(); up('tags', [...new Set([...s.tags, customTag.trim()])]); setCustomTag(''); } }}
                placeholder="+ 직접 입력 후 Enter" className="h-8 w-40 rounded-full border border-dashed border-line-strong bg-transparent px-3 text-[12.5px] focus:border-brand focus:outline-none" />
            </div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ───────────── 인원·관리자 ───────────── */

function genPassword() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `sadak${n}`;
}

function MembersAdmin() {
  const { snap, me } = useStore();
  const { run } = useRun();
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [resetting, setResetting] = useState<Member | null>(null);
  const [addAdmin, setAddAdmin] = useState('');
  const [q, setQ] = useState('');
  if (!snap) return <Spinner />;
  const depts = new Map(snap.departments.map((d) => [d.id, d]));
  const admins = snap.members.filter((m) => m.isAdmin && m.active);
  const list = snap.members
    .filter((m) => !q || m.name.includes(q) || m.username.includes(q) || (depts.get(m.departmentId ?? '')?.name ?? '').includes(q))
    .sort((a, b) => Number(b.active) - Number(a.active) || (depts.get(a.departmentId ?? '')?.sort ?? 0) - (depts.get(b.departmentId ?? '')?.sort ?? 0));

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-[20px] font-extrabold">관리자</h1>
        <p className="mb-3 text-[13px] text-ink-3">관리자는 현장·인원·부서를 관리하고 전체 엑셀을 내려받을 수 있습니다. 회계 현황은 볼 수 없습니다.</p>
        <Card className="p-4">
          <div className="flex flex-wrap gap-2">
            {admins.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-2 rounded-full border border-line bg-sunken py-1 pl-1 pr-2 text-[13px] font-semibold">
                <Avatar id={m.id} name={m.name} size={24} />{m.name} {m.title}
                {m.id !== me.id && (
                  <button aria-label={`${m.name} 관리자 해제`} className="text-ink-3 hover:text-danger"
                    onClick={() => run(() => api.admin.updateMember({ ...m, isAdmin: false }), `${m.name}님의 관리자 권한을 해제했습니다`)}>×</button>
                )}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Select id="add-admin" value={addAdmin} onChange={(e) => setAddAdmin(e.target.value)} className="!w-auto min-w-[200px]">
              <option value="">관리자로 추가할 사람 선택</option>
              {snap.members.filter((m) => m.active && !m.isAdmin).map((m) => <option key={m.id} value={m.id}>{m.name} {m.title} · {depts.get(m.departmentId ?? '')?.name ?? '부서 없음'}</option>)}
            </Select>
            <Button disabled={!addAdmin} onClick={async () => {
              const m = snap.members.find((x) => x.id === addAdmin);
              if (m && await run(() => api.admin.updateMember({ ...m, isAdmin: true }), `${m.name}님을 관리자로 추가했습니다`)) setAddAdmin('');
            }}><ShieldCheck size={15} />관리자 추가</Button>
          </div>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-extrabold">인원 <span className="text-ink-3">{snap.members.filter((m) => m.active).length}명</span></h2>
            <p className="text-[13px] text-ink-3">아이디와 임시 비밀번호를 만들어 전달하면, 처음 로그인할 때 본인이 비밀번호를 바꿉니다.</p>
          </div>
          <div className="flex gap-2">
            <Input id="member-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·부서 검색" className="!w-40" />
            <Button tone="primary" onClick={() => setEditing('new')}><UserPlus size={16} />인원 추가</Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                <th className="px-4 py-2.5 font-bold">이름</th>
                <th className="px-3 py-2.5 font-bold">아이디</th>
                <th className="px-3 py-2.5 font-bold">부서</th>
                <th className="px-3 py-2.5 font-bold">권한</th>
                <th className="px-3 py-2.5 font-bold">상태</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className={cx('border-b border-line last:border-0', !m.active && 'opacity-50')}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar id={m.id} name={m.name} size={26} /><b>{m.name}</b> <span className="text-ink-3">{m.title}</span></span></td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-ink-2">{m.username}</td>
                  <td className="px-3 py-2.5">{depts.get(m.departmentId ?? '')?.name ?? <span className="text-ink-3">—</span>}</td>
                  <td className="px-3 py-2.5"><span className="flex gap-1">{m.isCeo && <Badge tone="brand">대표</Badge>}{m.isAdmin && <Badge tone="warn">관리자</Badge>}{!m.isCeo && !m.isAdmin && <span className="text-ink-3">직원</span>}</span></td>
                  <td className="px-3 py-2.5">{m.active ? (m.mustChangePassword ? <Badge tone="note">첫 로그인 전</Badge> : <Badge tone="ok">사용 중</Badge>) : <Badge>중지</Badge>}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <IconButton label="비밀번호 초기화" onClick={() => setResetting(m)}><KeyRound size={16} /></IconButton>
                      <IconButton label="수정" onClick={() => setEditing(m)}><Pencil size={16} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && <MemberForm member={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPassword member={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function MemberForm({ member, onClose }: { member: Member | null; onClose(): void }) {
  const { snap, me } = useStore();
  const { run, busy } = useRun();
  const [m, set] = useState({
    name: member?.name ?? '', title: member?.title ?? '', username: member?.username ?? '', password: genPassword(),
    departmentId: member?.departmentId ?? '', isAdmin: member?.isAdmin ?? false, isCeo: member?.isCeo ?? false, active: member?.active ?? true,
  });
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  if (!snap) return null;
  const up = <K extends keyof typeof m>(k: K, v: (typeof m)[K]) => set((x) => ({ ...x, [k]: v }));
  const isSelf = member?.id === me.id;
  const validUser = /^[a-z0-9._-]{3,30}$/.test(m.username);

  const save = async () => {
    if (member) {
      const renamed = m.username !== member.username;
      const ok = await run(async () => {
        if (renamed) await api.admin.changeUsername(member.id, m.username);
        await api.admin.updateMember({ ...member, username: m.username, name: m.name, title: m.title, departmentId: m.departmentId || null, isAdmin: m.isAdmin, isCeo: m.isCeo, active: m.active });
      }, renamed ? `저장했습니다. 이제 아이디 ${m.username}(으)로 로그인합니다` : '저장했습니다');
      if (ok) onClose();
    } else {
      const ok = await run(() => api.admin.createMember({ username: m.username, password: m.password, name: m.name, title: m.title, departmentId: m.departmentId || null, isAdmin: m.isAdmin, isCeo: m.isCeo }), `${m.name}님 계정을 만들었습니다`);
      if (ok) setCreated({ username: m.username, password: m.password });
    }
  };

  if (created) {
    const text = `[사닥다리 주간보고]\n접속 주소: ${location.origin}${location.pathname}\n아이디: ${created.username}\n임시 비밀번호: ${created.password}\n처음 로그인하면 비밀번호를 바꿔주세요.`;
    return (
      <Modal open onClose={onClose} title="계정을 만들었습니다" footer={<>
        <Button onClick={() => navigator.clipboard?.writeText(text).catch(() => undefined)}>안내문 복사</Button>
        <Button tone="primary" onClick={onClose}>닫기</Button>
      </>}>
        <p className="mb-3 text-[13.5px] text-ink-2">아래 내용을 카카오톡이나 문자로 전달해 주세요.</p>
        <pre className="select-all whitespace-pre-wrap rounded-lg bg-sunken p-3 text-[13px] leading-relaxed">{text}</pre>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={member ? `${member.name} 정보 수정` : '인원 추가'} footer={<>
      <Button onClick={onClose}>취소</Button>
      <Button tone="primary" onClick={save} disabled={busy || !m.name.trim() || !validUser || (!member && m.password.length < 6)}>{member ? '저장' : '계정 만들기'}</Button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="이름"><Input id="member-name" value={m.name} onChange={(e) => up('name', e.target.value)} autoFocus /></Field>
        <Field label="직급"><Input id="member-title" value={m.title} onChange={(e) => up('title', e.target.value)} placeholder="예: 부장" /></Field>
        <Field label="아이디" hint={member ? '바꾸면 새 아이디로 로그인합니다. 비밀번호는 그대로입니다' : '영문 소문자·숫자·점, 3~30자'}>
          <Input id="member-username" value={m.username} onChange={(e) => up('username', e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="예: hong.gildong" />
        </Field>
        {!member && <Field label="임시 비밀번호" hint="6자 이상"><Input id="member-password" value={m.password} onChange={(e) => up('password', e.target.value)} /></Field>}
        {m.username && !validUser && <p className="text-[12.5px] text-danger sm:col-span-2">아이디는 영문 소문자, 숫자, 점(.), 밑줄, 하이픈으로 3~30자여야 합니다.</p>}
        <div className="sm:col-span-2">
          <Field label="부서">
            <Select id="member-dept" value={m.departmentId} onChange={(e) => up('departmentId', e.target.value)}>
              <option value="">부서 없음 (대표, 취합 담당 등)</option>
              {activeDepartments(snap).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="space-y-3 sm:col-span-2">
          <Toggle checked={m.isAdmin} onChange={(v) => up('isAdmin', v)} disabled={isSelf} label={<>관리자 <span className="text-ink-3">현장·인원·부서 관리, 전체 엑셀</span></>} />
          <Toggle checked={m.isCeo} onChange={(v) => up('isCeo', v)} label={<>대표 <span className="text-ink-3">전체 열람, 지시사항·피드백 입력, 회계 현황</span></>} />
          {member && <Toggle checked={m.active} onChange={(v) => up('active', v)} disabled={isSelf} label={<>계정 사용 <span className="text-ink-3">끄면 로그인할 수 없고 기록은 남습니다</span></>} />}
        </div>
      </div>
    </Modal>
  );
}

function ResetPassword({ member, onClose }: { member: Member; onClose(): void }) {
  const { run, busy } = useRun();
  const [pw, setPw] = useState(genPassword());
  const [done, setDone] = useState(false);
  return (
    <Modal open onClose={onClose} title={`${member.name} 비밀번호 초기화`} footer={done
      ? <Button tone="primary" onClick={onClose}>닫기</Button>
      : <><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || pw.length < 6} onClick={async () => setDone(await run(() => api.admin.resetPassword(member.id, pw)))}>초기화</Button></>}>
      {done ? (
        <p className="text-[14px]">임시 비밀번호 <b className="select-all rounded bg-sunken px-1.5 font-mono">{pw}</b> 로 바꿨습니다. 다음 로그인 때 새 비밀번호를 정하게 됩니다.</p>
      ) : (
        <Field label="임시 비밀번호" hint="6자 이상. 본인에게 전달해 주세요"><Input id="reset-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      )}
    </Modal>
  );
}

/* ───────────── 부서·열람 권한 ───────────── */

function DeptsAdmin() {
  const { snap } = useStore();
  const { run } = useRun();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  if (!snap) return <Spinner />;
  const depts = [...snap.departments].sort((a, b) => a.sort - b.sort);
  const active = depts.filter((d) => d.active);
  const headcount = (id: string) => snap.members.filter((m) => m.active && m.departmentId === id).length;

  const move = (d: Department, dir: -1 | 1) => {
    const i = depts.indexOf(d);
    const o = depts[i + dir];
    if (!o) return;
    void run(async () => { await api.admin.saveDepartment({ ...d, sort: o.sort }); await api.admin.saveDepartment({ ...o, sort: d.sort }); });
  };

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-[20px] font-extrabold">부서</h1>
        <p className="mb-3 text-[13px] text-ink-3">'현장 칸'을 켠 부서는 현장마다 보고 칸이 생깁니다 (지금은 공무, 인테리어/디자인, CM, 견적).</p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          {depts.map((d, i) => (
            <div key={d.id} className={cx('flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0', !d.active && 'opacity-50')}>
              <div className="flex flex-col">
                <button aria-label="위로" disabled={i === 0} onClick={() => move(d, -1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowUp size={15} /></button>
                <button aria-label="아래로" disabled={i === depts.length - 1} onClick={() => move(d, 1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowDown size={15} /></button>
              </div>
              <div className="min-w-[140px] flex-1">
                {renaming?.id === d.id ? (
                  <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (renaming.name.trim() && await run(() => api.admin.saveDepartment({ ...d, name: renaming.name.trim() }), '부서 이름을 바꿨습니다')) setRenaming(null); }}>
                    <Input id={`rename-${d.id}`} value={renaming.name} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} autoFocus className="!h-9" />
                    <Button size="sm" tone="primary" type="submit">저장</Button>
                    <Button size="sm" type="button" onClick={() => setRenaming(null)}>취소</Button>
                  </form>
                ) : (
                  <p className="font-bold">{d.name} <span className="font-medium text-ink-3">{headcount(d.id)}명</span></p>
                )}
              </div>
              <Toggle checked={d.writesSites} onChange={(v) => run(() => api.admin.saveDepartment({ ...d, writesSites: v }))} label="현장 칸" />
              <Toggle checked={d.active} onChange={(v) => run(() => api.admin.saveDepartment({ ...d, active: v }))} label="사용" />
              <div className="flex">
                <Button size="sm" tone="ghost" onClick={() => setRenaming({ id: d.id, name: d.name })}><Pencil size={14} />이름 변경</Button>
                <IconButton label="삭제" onClick={() => run(() => api.admin.deleteDepartment(d.id), `${d.name} 부서를 삭제했습니다`)}><Trash2 size={15} /></IconButton>
              </div>
            </div>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          if (await run(() => api.admin.saveDepartment({ id: newId('new'), name: name.trim(), sort: Math.max(0, ...depts.map((x) => x.sort)) + 1, writesSites: false, active: true }), '부서를 추가했습니다')) setName('');
        }}>
          <Input id="new-dept" value={name} onChange={(e) => setName(e.target.value)} placeholder="새 부서 이름" className="!w-56" />
          <Button type="submit" disabled={!name.trim()}><Plus size={15} />부서 추가</Button>
        </form>
      </section>

      <section>
        <h2 className="text-[18px] font-extrabold">협력 부서 열람 권한</h2>
        <p className="mb-3 text-[13px] text-ink-3">기본은 자기 부서만 봅니다. 체크하면 왼쪽 부서 사람들이 위쪽 부서의 보고를 <b>보기만</b> 할 수 있습니다. 대표님과 관리자는 항상 전체를 봅니다.</p>
        <GrantMatrix depts={active} />
      </section>
    </div>
  );
}

function GrantMatrix({ depts }: { depts: Department[] }) {
  const { snap } = useStore();
  const { run } = useRun();
  if (!snap) return null;
  const on = (v: string, t: string) => snap.grants.some((g) => g.viewerDepartmentId === v && g.targetDepartmentId === t);
  const toggle = (v: string, t: string) => {
    const current = snap.grants.filter((g) => g.viewerDepartmentId === v).map((g) => g.targetDepartmentId);
    const next = on(v, t) ? current.filter((x) => x !== t) : [...current, t];
    void run(() => api.admin.setGrants(v, next));
  };
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface shadow-card">
      <table className="border-separate border-spacing-0 text-[12.5px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 border-b border-r border-line bg-sunken px-3 py-2 text-left font-bold">보는 부서 ↓ / 보이는 부서 →</th>
            {depts.map((t) => <th key={t.id} className="sticky top-0 z-10 min-w-[72px] border-b border-line bg-sunken px-2 py-2 font-bold">{t.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {depts.map((v) => (
            <tr key={v.id}>
              <th className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 text-left font-bold">{v.name}</th>
              {depts.map((t) => (
                <td key={t.id} className="border-b border-line text-center">
                  {v.id === t.id ? <span className="text-ink-3">본인</span> : (
                    <input type="checkbox" aria-label={`${v.name}이(가) ${t.name} 보기`} checked={on(v.id, t.id)} onChange={() => toggle(v.id, t.id)} className="h-4 w-4 accent-[rgb(var(--brand))]" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────── 주차·내려받기 ───────────── */

function WeeksAdmin() {
  const { snap, toast } = useStore();
  const exportWeek = useExport();
  const [weeks, setWeeks] = useState<WeekSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.listWeeks().then(setWeeks).catch(() => setWeeks([])); }, []);
  const reportersCount = useMemo(() => snap?.members.filter((m) => m.active && m.departmentId && !m.isCeo).length ?? 0, [snap]);
  const cur = currentWeekId();

  return (
    <div>
      <h1 className="text-[20px] font-extrabold">주차·내려받기</h1>
      <p className="mb-4 text-[13px] text-ink-3">주차마다 전체 보고를 지금 쓰는 엑셀 양식 그대로 내려받습니다. 전체 내려받기는 관리자만 할 수 있습니다.</p>
      {!weeks ? <Spinner /> : (
        <div className="space-y-2">
          {weeks.map((w) => (
            <Card key={w.weekId} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-bold">{weekLabelLong(w.weekId)}{w.weekId === cur && <Badge tone="brand">이번 주</Badge>}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">작성자 {w.writers} / {reportersCount}명 · 작성된 칸 {w.entryCount}개</p>
              </div>
              <Button size="sm" tone="primary" disabled={busy === w.weekId} onClick={async () => {
                setBusy(w.weekId);
                try { await exportWeek(await api.loadWeek(w.weekId)); } catch { toast('불러오지 못했습니다.', 'error'); } finally { setBusy(null); }
              }}><Download size={14} />전체 엑셀</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── AI 설정 ───────────── */

function AiSettings() {
  const { toast } = useStore();
  const [model, setModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.getSettings().then((s) => setModel(s.summaryModel)).catch(() => setModel(SUMMARY_MODELS[0].id)); }, []);

  const choose = async (id: string) => {
    if (id === model) return;
    setSaving(true);
    try {
      const s = await api.admin.saveSettings({ summaryModel: id });
      setModel(s.summaryModel);
      toast('AI 요약 모델을 바꿨습니다. 다음 요약부터 적용됩니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[20px] font-extrabold">AI 설정</h1>
      <p className="mb-4 text-[13px] text-ink-3">대표님 대시보드의 AI 주간 요약에 쓰는 모델입니다. 비용은 보고 한 주(약 1만 6천 자)를 요약할 때의 어림값이며, 요약은 대표님이 버튼을 누를 때만 만들어집니다.</p>
      {model == null ? <Spinner /> : (
        <div className="space-y-2" role="radiogroup" aria-label="AI 요약 모델">
          {SUMMARY_MODELS.map((m) => {
            const on = m.id === model;
            return (
              <button key={m.id} role="radio" aria-checked={on} disabled={saving} onClick={() => choose(m.id)}
                className={cx('flex w-full items-center gap-3 rounded-xl border bg-surface p-4 text-left shadow-card transition-colors',
                  on ? 'border-brand ring-2 ring-brand/20' : 'border-line hover:border-line-strong')}>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-brand' : 'border-line-strong')}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-brand" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 font-bold">{m.name}{m.id === SUMMARY_MODELS[0].id && <Badge tone="brand">기본</Badge>}</span>
                  <span className="block text-[13px] text-ink-3">{m.note} · {m.cost}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
