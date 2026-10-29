import {
  ArchiveRestore, ArrowDown, ArrowLeft, ArrowUp, Bell, Building2, CheckCircle2, DatabaseBackup, Download, HardDrive, KeyRound, Layers, Pencil, Plus, ShieldCheck, Sparkles, Trash2, UserPlus, Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Logo } from '../../components/AppShell';
import { dueInfo } from '../../components/SiteCard';
import { Avatar, Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Segmented, Select, Spinner, StageChip, Toggle } from '../../components/ui';
import { newId, type SiteHistoryItem, type WeekSummary } from '../../lib/api';
import { api } from '../../lib/client';
import { activeDepartments, isCompleted } from '../../lib/derive';
import { formatBytes } from '../../lib/fileTypes';
import { SUMMARY_MODELS } from '../../lib/models';
import { isBuildStage, SITE_TAGS, type BackupInfo, type StageDef, type Department, type Member, type Site, type Stage, type StorageUsage } from '../../lib/types';
import { currentWeekId, shiftWeek, weekLabelLong } from '../../lib/week';
import { defaultView, useStore } from '../../state/store';
import { useExport } from '../useExport';

type Tab = 'sites' | 'members' | 'depts' | 'weeks' | 'storage' | 'ai';

export function AdminPage() {
  const { me, setView } = useStore();
  const [tab, setTab] = useState<Tab>('sites');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'sites', label: '현장 관리', icon: <Building2 size={16} /> },
    { id: 'members', label: '인원·관리자', icon: <Users size={16} /> },
    { id: 'depts', label: '부서·열람 권한', icon: <ShieldCheck size={16} /> },
    { id: 'weeks', label: '주차·내려받기', icon: <Download size={16} /> },
    { id: 'storage', label: '저장 공간', icon: <HardDrive size={16} /> },
    { id: 'ai', label: 'AI 설정', icon: <Sparkles size={16} /> },
  ];
  return (
    <div className="min-h-full bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-3 px-4 sm:px-6">
          <Logo size={34} />
          <div className="flex-1 leading-tight">
            <p className="text-[15px] font-bold">관리자 페이지</p>
            <p className="text-[12px] text-ink-3">사닥다리종합건설 주간보고</p>
          </div>
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
        {tab === 'storage' && <StorageAdmin />}
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
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<Site | null>(null);
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
        <div className="flex gap-2">
          <Button onClick={() => setManaging(true)}><Layers size={16} />단계 관리</Button>
          <Button tone="primary" onClick={() => setEditing(blank())}><Plus size={16} />현장 추가</Button>
        </div>
      </div>
      <Segmented<Stage | 'archived'> value={filter} onChange={setFilter} className="mb-4" options={[
        ...snap.stages.map((s) => ({ id: s.id as Stage | 'archived', label: `${s.short} ${count(s.id)}` })),
        { id: 'archived', label: `보관함 ${all.filter((s) => s.archived).length}` },
      ]} />
      {list.length === 0 ? <Empty title="이 단계의 현장이 없습니다" /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
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
                <p className="text-[12.5px] text-ink-3">{[s.note, s.process, s.progress != null ? `${s.progress}%` : s.scale, isCompleted(s) && isBuildStage(s.stage) ? '' : dueInfo(s).label].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-1.5">
                {s.archived ? (
                  <>
                    <Button size="sm" onClick={() => run(() => api.admin.saveSite({ ...s, archived: false }), '현장을 다시 꺼냈습니다')}><ArchiveRestore size={14} />다시 꺼내기</Button>
                    <IconButton label="현장 삭제" onClick={() => setDeleting(s)} className="hover:text-danger"><Trash2 size={15} /></IconButton>
                  </>
                ) : (
                  <>
                    {isBuildStage(s.stage) && !isCompleted(s) && (
                      <Button size="sm" onClick={() => run(() => api.admin.saveSite({ ...s, progress: 100, process: '준공완료', completedAt: new Date().toISOString().slice(0, 10) }), `${s.name} 준공 처리했습니다`)}>
                        <CheckCircle2 size={14} />준공 처리
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setEditing(s)}><Pencil size={14} />수정</Button>
                    <IconButton label="현장 삭제" onClick={() => setDeleting(s)} className="hover:text-danger"><Trash2 size={15} /></IconButton>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <SiteForm site={editing} onClose={() => setEditing(null)} />}
      {managing && <StagesModal onClose={() => setManaging(false)} />}
      {deleting && <DeleteSiteModal site={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

/** 현장 영구 삭제. 기록이 모두 지워지므로 현장 이름을 입력해야 지울 수 있다 */
function DeleteSiteModal({ site, onClose }: { site: Site; onClose(): void }) {
  const { run, busy } = useRun();
  const [typed, setTyped] = useState('');
  const [history, setHistory] = useState<SiteHistoryItem[] | null>(null);
  useEffect(() => { api.siteHistory(site.id).then(setHistory).catch(() => setHistory([])); }, [site.id]);
  const entries = history?.reduce((n, h) => n + h.entries.length, 0) ?? 0;
  const photos = history?.reduce((n, h) => n + h.photos.length, 0) ?? 0;
  const ok = typed.trim() === site.name.trim();

  return (
    <Modal open onClose={() => !busy && onClose()} title="현장 삭제" width={500}
      footer={<>
        <Button onClick={onClose} disabled={busy}>취소</Button>
        <Button tone="danger" disabled={!ok || busy} onClick={async () => { if (await run(() => api.admin.deleteSite(site.id), `${site.name} 현장을 삭제했습니다`)) onClose(); }}>
          {busy ? <Spinner /> : <Trash2 size={15} />}영구 삭제
        </Button>
      </>}>
      <div className="space-y-3 text-[14px] leading-[1.7]">
        <p><b>{site.name}</b> 현장과 이 현장의 <b className="text-danger">모든 주차 기록</b>을 지웁니다. 지운 뒤에는 되살릴 수 없습니다.</p>
        <div className="rounded-xl bg-sunken px-3.5 py-2.5 text-[13px] text-ink-2">
          {history == null ? <Spinner /> : history.length === 0 ? '남아 있는 보고 기록이 없습니다.' : (
            <>함께 지워지는 것: {history.length}주치 기록 · 부서 보고 {entries}칸 · 사진 {photos}장 · 대표님 지시·피드백·첨부파일</>
          )}
        </div>
        <p className="text-[13px] text-ink-3">기록을 남겨두고 목록에서만 빼려면 삭제 대신 <b className="text-ink-2">수정 → 보관함으로</b>를 쓰세요.</p>
        <Field label={`확인을 위해 현장 이름 "${site.name}"을 입력하세요`}>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={site.name} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

/** 현장 단계 이름 변경·순서·추가·삭제. 현장이 있는 단계는 지울 수 없다 */
function StagesModal({ onClose }: { onClose(): void }) {
  const { snap } = useStore();
  const { run, busy } = useRun();
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  if (!snap) return null;
  const stages = snap.stages;
  const used = (id: string) => snap.sites.filter((x) => x.stage === id).length;
  const nameOf = (st: StageDef) => names[st.id] ?? st.short;

  const rename = (st: StageDef) => {
    const name = nameOf(st).trim();
    if (!name || name === st.short) return;
    void run(() => api.admin.saveStage({ ...st, short: name, label: name }), '단계 이름을 바꿨습니다');
  };
  const move = (i: number, d: -1 | 1) => {
    const a = stages[i];
    const b = stages[i + d];
    void run(async () => { await api.admin.saveStage({ ...a, sort: b.sort }); await api.admin.saveStage({ ...b, sort: a.sort }); });
  };
  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    const st: StageDef = { id: newId('st'), label: name, short: name, sort: Math.max(0, ...stages.map((x) => x.sort)) + 1 };
    if (await run(() => api.admin.saveStage(st), `'${name}' 단계를 추가했습니다`)) setNewName('');
  };

  return (
    <Modal open onClose={onClose} title="현장 단계 관리" width={520} footer={<Button onClick={onClose}>닫기</Button>}>
      <p className="mb-3 text-[13px] text-ink-3">단계 이름은 대시보드 현장 현황 탭, 표 보기, 엑셀에 그대로 쓰입니다. 현장이 남아 있는 단계는 지울 수 없습니다.</p>
      <div className="overflow-hidden rounded-xl border border-line">
        {stages.map((st, i) => (
          <div key={st.id} className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-0">
            <div className="flex flex-col">
              <button aria-label="위로" disabled={i === 0 || busy} onClick={() => move(i, -1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowUp size={14} /></button>
              <button aria-label="아래로" disabled={i === stages.length - 1 || busy} onClick={() => move(i, 1)} className="text-ink-3 hover:text-ink disabled:opacity-25"><ArrowDown size={14} /></button>
            </div>
            <Input value={nameOf(st)} onChange={(e) => setNames((n) => ({ ...n, [st.id]: e.target.value }))} onBlur={() => rename(st)}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="flex-1" aria-label="단계 이름" />
            <span className="w-14 shrink-0 text-right text-[12.5px] text-ink-3">현장 {used(st.id)}</span>
            <IconButton label="단계 삭제" disabled={used(st.id) > 0 || busy} onClick={() => run(() => api.admin.deleteStage(st.id), `'${st.short}' 단계를 지웠습니다`)}>
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 단계 이름 (예: 자체사업, 입찰진행)" />
        <Button tone="primary" type="submit" disabled={!newName.trim() || busy}><Plus size={15} />추가</Button>
      </form>
    </Modal>
  );
}

function SiteForm({ site, onClose }: { site: Site; onClose(): void }) {
  const { run, busy } = useRun();
  const [s, set] = useState<Site>(site);
  const [customTag, setCustomTag] = useState('');
  const [addingStage, setAddingStage] = useState<string | null>(null);
  const { snap } = useStore();
  const isNew = site.id.startsWith('new_');
  const addStage = async () => {
    const name = (addingStage ?? '').trim();
    if (!name) return;
    const stage: StageDef = { id: newId('st'), label: name, short: name, sort: Math.max(0, ...(snap?.stages ?? []).map((x) => x.sort)) + 1 };
    if (await run(() => api.admin.saveStage(stage), `'${name}' 단계를 추가했습니다`)) {
      up('stage', stage.id);
      setAddingStage(null);
    }
  };
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
            {(snap?.stages ?? []).map((x) => <option key={x.id} value={x.id}>{x.short}</option>)}
          </Select>
          {addingStage == null ? (
            <button type="button" onClick={() => setAddingStage('')} className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-ink hover:underline">
              <Plus size={13} />단계 추가
            </button>
          ) : (
            <div className="mt-1.5 flex gap-1.5">
              <Input id="new-stage" value={addingStage} onChange={(e) => setAddingStage(e.target.value)} placeholder="예: 자체사업" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addStage(); } if (e.key === 'Escape') { e.stopPropagation(); setAddingStage(null); } }} />
              <Button size="sm" tone="primary" onClick={addStage} disabled={!addingStage.trim()}>추가</Button>
              <Button size="sm" tone="ghost" onClick={() => setAddingStage(null)}>취소</Button>
            </div>
          )}
        </Field>
        <Field label={isBuildStage(s.stage) ? '주요 진행 공정' : '주요 진행 사항'}><Input id="site-process" value={s.process} onChange={(e) => up('process', e.target.value)} placeholder="예: 철콘공사" /></Field>
        <Field label={isBuildStage(s.stage) ? '준공예상일' : '착공예상일'} hint="비우면 아래 표기가 쓰입니다">
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
  const [pushOn, setPushOn] = useState<Set<string>>(() => new Set());
  useEffect(() => { api.admin.pushMembers().then((ids) => setPushOn(new Set(ids))).catch(() => undefined); }, []);
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
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
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
                  <td className="px-3 py-2.5"><span className="flex items-center gap-1.5">{m.active ? (m.mustChangePassword ? <Badge tone="note">첫 로그인 전</Badge> : <Badge tone="ok">사용 중</Badge>) : <Badge>중지</Badge>}
                    {pushOn.has(m.id) && <span title="알림 켬" className="text-brand-ink"><Bell size={14} /></span>}</span></td>
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
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
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
    <div className="max-h-[70vh] overflow-auto rounded-2xl border border-line bg-surface shadow-card">
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
      <BackupsCard />
    </div>
  );
}

/* ───────────── 저장 공간 ───────────── */

/** 무료 요금제의 파일 저장 한도 */
const STORAGE_LIMIT = 1024 * 1024 * 1024;

function StorageAdmin() {
  const { reload, toast } = useStore();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [months, setMonths] = useState('6');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.admin.storageUsage().then(setUsage).catch((e) => { toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error'); setUsage({ photoCount: 0, photoBytes: 0, fileCount: 0, fileBytes: 0, estimated: false }); });
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const cutoff = shiftWeek(currentWeekId(), -Math.round((Number(months) * 52) / 12));
  const used = usage ? usage.photoBytes + usage.fileBytes : 0;
  const pct = Math.min(100, (used / STORAGE_LIMIT) * 100);

  const cleanup = async () => {
    setBusy(true);
    try {
      const r = await api.admin.cleanupMedia(cutoff);
      toast(`사진 ${r.photos}장, 파일 ${r.files}개를 정리했습니다 (${formatBytes(r.bytes)})`);
      setConfirm(false);
      await Promise.all([load(), reload()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : '정리하지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[720px]">
      <h1 className="text-[20px] font-extrabold">저장 공간</h1>
      <p className="mb-4 text-[13px] text-ink-3">현장 사진과 첨부파일이 차지하는 공간입니다. 보고 글은 거의 공간을 차지하지 않습니다.</p>
      {!usage ? <Spinner /> : (
        <Card className="p-5">
          <div className="flex items-end justify-between gap-3">
            <p className="text-[26px] font-extrabold tabular">{formatBytes(used)}</p>
            <p className="pb-1 text-[13px] text-ink-3">무료 한도 {formatBytes(STORAGE_LIMIT)} 중 {pct.toFixed(pct < 10 ? 1 : 0)}%</p>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken">
            <div className={cx('h-full rounded-full', pct > 85 ? 'bg-danger' : pct > 65 ? 'bg-warn' : 'bg-brand')} style={{ width: `${Math.max(pct, used ? 1 : 0)}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl bg-sunken px-3 py-2.5"><dt className="text-ink-3">현장 사진</dt><dd className="mt-0.5 font-bold tabular">{usage.photoCount}장 · {formatBytes(usage.photoBytes)}</dd></div>
            <div className="rounded-xl bg-sunken px-3 py-2.5"><dt className="text-ink-3">첨부파일</dt><dd className="mt-0.5 font-bold tabular">{usage.fileCount}개 · {formatBytes(usage.fileBytes)}</dd></div>
          </dl>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="text-[16px] font-bold">오래된 사진·파일 정리</h2>
        <p className="mt-1 text-[13px] leading-[1.6] text-ink-3">공간이 부족해지면 오래된 사진과 첨부파일만 지워서 다시 쓸 수 있습니다. <b className="text-ink-2">보고 글, 지시사항, 피드백은 그대로 남습니다.</b> 지운 파일은 되살릴 수 없으니 필요한 파일은 먼저 내려받아 두세요.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Select value={months} onChange={(e) => setMonths(e.target.value)} className="!w-auto">
            <option value="3">3개월 지난</option>
            <option value="6">6개월 지난</option>
            <option value="12">1년 지난</option>
            <option value="24">2년 지난</option>
          </Select>
          <span className="text-[13px] text-ink-2">사진·파일 ({weekLabelLong(cutoff)} 이전)</span>
          <Button tone="danger" className="ml-auto" onClick={() => setConfirm(true)}><Trash2 size={15} />정리하기</Button>
        </div>
      </Card>

      <Modal open={confirm} onClose={() => !busy && setConfirm(false)} title="오래된 사진·파일 정리"
        footer={<><Button onClick={() => setConfirm(false)} disabled={busy}>취소</Button><Button tone="danger" onClick={cleanup} disabled={busy}>{busy ? <Spinner /> : <Trash2 size={15} />}지우기</Button></>}>
        <p className="text-[14px] leading-[1.7]"><b>{weekLabelLong(cutoff)}</b>보다 이전 주차의 현장 사진과 첨부파일을 모두 지웁니다. 보고 글은 남고, 지운 파일은 되살릴 수 없습니다.</p>
      </Modal>
    </div>
  );
}

/* ───────────── 백업 ───────────── */

function BackupsCard() {
  const { toast } = useStore();
  const { run, busy } = useRun();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const load = () => api.admin.listBackups().then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card className="mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold">자동 백업</h2>
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-3">매주 월요일 오전 8시에 보고 글·지시·피드백·현장·인원 정보를 통째로 백업합니다. 최근 12개를 남기며, 사진·첨부파일은 저장 공간에 그대로 있습니다.
            서버에 문제가 생길 때를 대비해 <b className="text-ink-2">한 달에 한 번 정도 내려받아 회사 컴퓨터에 보관</b>해 두세요.</p>
        </div>
        <Button onClick={async () => { if (await run(() => api.admin.createBackup(), '지금 백업했습니다')) void load(); }} disabled={busy}>
          {busy ? <Spinner /> : <DatabaseBackup size={15} />}지금 백업
        </Button>
      </div>
      {list == null ? <div className="mt-4"><Spinner /></div> : list.length === 0 ? <p className="mt-4 text-[13px] text-ink-3">아직 백업이 없습니다. 첫 자동 백업은 다음 월요일 오전에 만들어집니다.</p> : (
        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          {list.map((b) => (
            <div key={b.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold tabular">{new Date(b.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                <p className="text-[12px] text-ink-3">{b.kind === 'auto' ? '자동' : '직접'} · {formatBytes(b.sizeBytes)}</p>
              </div>
              <Button size="sm" disabled={downloading === b.id} onClick={async () => {
                setDownloading(b.id);
                try { await api.admin.downloadBackup(b); } catch (e) { toast(e instanceof Error ? e.message : '내려받지 못했습니다.', 'error'); } finally { setDownloading(null); }
              }}>{downloading === b.id ? <Spinner /> : <Download size={14} />}내려받기</Button>
            </div>
          ))}
        </div>
      )}
    </Card>
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
