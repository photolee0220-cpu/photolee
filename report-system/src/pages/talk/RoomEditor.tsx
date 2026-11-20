import { FolderLock, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';
import { activeDepartments, byId } from '../../lib/derive';
import { DEFAULT_TALK_SETTINGS, isBuiltinRoom, type ChatRoom, type TalkSettings } from '../../lib/talkTypes';
import { useStore } from '../../state/store';
import { Avatar, Button, Card, cx, Field, Input, Modal, Select, Spinner, Toggle } from '../../components/ui';
import { RoomIcon } from './Chat';
import { archiveOn, refreshTalk, talkExtras } from './useTalk';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function blankRoom(): ChatRoom {
  return { id: `room_${Date.now().toString(36)}`, kind: 'group', name: '', siteId: null, memberIds: [], pinned: '', pinnedBy: null, pinnedAt: null, mutedBy: [], meetingDow: null, sort: 100, createdAt: new Date().toISOString() };
}

/** 관리자: 방 만들기·고치기·지우기, 인원 넣고 빼기 */
export function RoomEditor({ room, onClose, onSaved }: { room: ChatRoom | null; onClose(): void; onSaved(): void }) {
  const { snap, toast } = useStore();
  const [r, setR] = useState<ChatRoom>(room ?? blankRoom());
  const builtin = isBuiltinRoom(r);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const members = (snap?.members ?? []).filter((m) => m.active);
  const depts = activeDepartments(snap!);
  const sites = (snap?.sites ?? []).filter((s) => !s.archived);
  const has = (id: string) => r.memberIds.includes(id);
  const toggle = (ids: string[], on: boolean) => setR({ ...r, memberIds: on ? [...new Set([...r.memberIds, ...ids])] : r.memberIds.filter((x) => !ids.includes(x)) });
  const groups = [
    { id: 'top', name: '대표·관리자·임원', list: members.filter((m) => !m.departmentId) },
    ...depts.map((d) => ({ id: d.id, name: d.name, list: members.filter((m) => m.departmentId === d.id) })),
  ].map((g) => ({ ...g, list: g.list.filter((m) => !q.trim() || `${m.name}${m.title}${g.name}`.includes(q.trim())) })).filter((g) => g.list.length);
  const siteStaff = r.siteId ? members.filter((m) => m.homeSiteId === r.siteId).map((m) => m.id) : [];

  const save = async () => {
    setBusy(true);
    try { await api.talk.admin.saveRoom(r); await refreshTalk(); toast(room ? '방을 고쳤습니다.' : '방을 만들었습니다.'); onSaved(); } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!room || !confirm(`'${room.name}' 방과 대화 기록을 모두 지울까요? 되돌릴 수 없습니다.`)) return;
    setBusy(true);
    try { await api.talk.admin.deleteRoom(room.id); await refreshTalk(); toast('방을 지웠습니다.'); onSaved(); } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.', 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={room ? '방 관리' : '새 채팅방'} width={620}
      footer={<>
        {room && !builtin && <Button tone="ghost" className="mr-auto !text-danger" disabled={busy} onClick={() => void remove()}><Trash2 size={15} />방 지우기</Button>}
        <Button onClick={onClose}>취소</Button>
        <Button tone="primary" disabled={busy || !r.name.trim()} onClick={() => void save()}>{busy && <Spinner />}저장</Button>
      </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="방 이름"><Input autoFocus={!room} value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="예: 건설사업부, 소장방" /></Field>
        {builtin ? (
          <Field label="방 종류"><p className="flex h-10 items-center text-[13.5px] text-ink-2">{r.kind === 'inquiry' ? '문의 카드가 붙는 기본 방' : '안전 당부가 오는 기본 방'} · 인원만 바꿀 수 있습니다</p></Field>
        ) : (
          <Field label="현장 연결 (선택)" hint="현장을 연결하면 [자료] 칸(회의록·공사일보·공정표)이 붙습니다">
            <Select value={r.siteId ?? ''} onChange={(e) => { const s = sites.find((x) => x.id === e.target.value); setR({ ...r, siteId: e.target.value || null, name: r.name || s?.name || '', meetingDow: e.target.value ? r.meetingDow : null }); }}>
              <option value="">연결 안 함 (부서방·소장방 등)</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        {!builtin && r.siteId && (
          <Field label="정기회의 요일" hint="회의 다음 날까지 회의록이 없으면 '미등록'으로 표시">
            <Select value={r.meetingDow ?? ''} onChange={(e) => setR({ ...r, meetingDow: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">정하지 않음</option>
              {DOW.map((d, i) => <option key={i} value={i}>매주 {d}요일</option>)}
            </Select>
          </Field>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <p className="text-[14px] font-bold">인원 <span className="text-brand-ink">{r.memberIds.length}명</span></p>
        {r.kind === 'site' && siteStaff.length > 0 && <Button size="sm" onClick={() => toggle(siteStaff, true)}><Plus size={14} />이 현장 소속 직원 넣기</Button>}
        <div className="relative ml-auto w-full sm:w-52">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·부서 찾기" className="!h-9 pl-8" />
        </div>
      </div>
      <div className="mt-2 space-y-3">
        {groups.map((g) => {
          const ids = g.list.map((m) => m.id);
          const all = ids.every(has);
          return (
            <div key={g.id} className="rounded-xl border border-line p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <p className="text-[13px] font-bold">{g.name}</p>
                <button onClick={() => toggle(ids, !all)} className="ml-auto text-[12px] font-semibold text-brand-ink hover:underline">{all ? '모두 빼기' : '부서 전체 넣기'}</button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.list.map((m) => (
                  <button key={m.id} onClick={() => toggle([m.id], !has(m.id))}
                    className={cx('flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-[13px] font-semibold', has(m.id) ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface text-ink-2 hover:border-brand')}>
                    <Avatar id={m.id} name={m.name} size={22} muted={!has(m.id)} />{m.name}<span className={cx('font-normal', has(m.id) ? 'text-on-brand/80' : 'text-ink-3')}>{m.title}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** 관리자 페이지: 채팅방 목록 + 소통 설정 */
export function AdminRooms() {
  const { snap, toast } = useStore();
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [edit, setEdit] = useState<ChatRoom | 'new' | null>(null);
  const [settings, setSettings] = useState<TalkSettings>(DEFAULT_TALK_SETTINGS);
  const load = () => {
    api.talk.admin.rooms().then(setRooms).catch((e) => { toast(e.message, 'error'); setRooms([]); });
    api.talk.load().then((s) => setSettings(s.settings)).catch(() => undefined);
  };
  useEffect(load, [toast]);
  const sites = byId(snap?.sites ?? []);
  const saveSettings = (s: TalkSettings) => { setSettings(s); void api.talk.admin.saveSettings(s).then(() => toast('저장했습니다.')).catch((e) => toast(e.message, 'error')); };
  const installUrl = new URL(`${import.meta.env.BASE_URL}install/`, window.location.origin).href;
  return (
    <div className="space-y-4">
      {talkExtras() && (
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <img src={`${import.meta.env.BASE_URL}install/qr.svg`} alt="설치 안내 QR" className="h-28 w-28 rounded-lg border border-line bg-white p-1.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-bold">직원 설치 안내</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-3">직원이 휴대폰 카메라로 이 QR을 찍으면 아이폰·안드로이드별 '홈 화면에 추가 → 알림 켜기' 방법이 그림으로 나옵니다. 인쇄해서 사무실·현장 사무소에 붙여 두거나 공지에 주소를 넣으세요.</p>
            <p className="mt-1 truncate text-[12.5px] font-semibold text-ink-2">{installUrl}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={installUrl} target="_blank" rel="noopener" className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold hover:bg-sunken">안내 페이지 열기</a>
              <Button size="sm" onClick={() => { const w = window.open(installUrl, '_blank'); w?.addEventListener('load', () => w.print()); }}>인쇄하기</Button>
              <Button size="sm" tone="ghost" onClick={() => void navigator.clipboard?.writeText(installUrl).then(() => toast('주소를 복사했습니다.'))}>주소 복사</Button>
            </div>
          </div>
        </Card>
      )}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-[16px] font-bold">채팅방</h3>
          <Button tone="primary" size="sm" className="ml-auto" onClick={() => setEdit('new')}><Plus size={15} />방 만들기</Button>
        </div>
        <p className="mb-3 text-[13px] text-ink-3">방 이름을 넣고 인원을 고르면 방이 생깁니다. 현장을 연결하면 현장방이 됩니다. 문의방·안전방은 기본 방이라 인원만 바꿉니다. 1:1 대화는 두 사람만 볼 수 있어 여기에 나오지 않습니다.</p>
        {!rooms ? <Spinner /> : (
          <ul className="divide-y divide-line">
            {rooms.map((r) => (
              <li key={r.id}>
                <button onClick={() => setEdit(r)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunken/50">
                  <RoomIcon room={r} size={15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{r.name}</span>
                    <span className="block truncate text-[12px] text-ink-3">{isBuiltinRoom(r) ? '기본 방' : r.siteId ? `현장 연결: ${sites.get(r.siteId)?.name ?? ''}` : '일반 방'}{r.meetingDow != null ? ` · 매주 ${DOW[r.meetingDow]} 회의` : ''}</span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold text-ink-2">{r.memberIds.length}명</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {archiveOn() && <ArchiveAccess settings={settings} onSave={saveSettings} />}
      <Card className="p-5">
        <h3 className="mb-3 text-[16px] font-bold">알림·메시지 설정</h3>
        <div className="space-y-3">
          <Toggle checked={settings.quiet.enabled} onChange={(v) => saveSettings({ ...settings, quiet: { ...settings.quiet, enabled: v } })}
            label={<span><b>알림 쉬는 시간</b> <span className="text-ink-3">이 시간에는 채팅 알림을 보내지 않습니다 (공지·@부르기는 예외)</span></span>} />
          {settings.quiet.enabled && (
            <div className="flex items-center gap-2 pl-12 text-[13px]">
              <Input type="time" value={settings.quiet.from} onChange={(e) => saveSettings({ ...settings, quiet: { ...settings.quiet, from: e.target.value } })} className="!w-32" />
              부터
              <Input type="time" value={settings.quiet.to} onChange={(e) => saveSettings({ ...settings, quiet: { ...settings.quiet, to: e.target.value } })} className="!w-32" />
              까지
            </div>
          )}
          <Toggle checked={settings.adminCanNotice} onChange={(v) => saveSettings({ ...settings, adminCanNotice: v })}
            label={<span><b>관리자도 전체 공지 쓰기</b> <span className="text-ink-3">기본은 대표님만 씁니다. 켜면 관리자도 대표님 대신 올릴 수 있습니다</span></span>} />
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-bold">메시지 지우기</span>
            <span className="text-ink-3">보낸 뒤</span>
            <Select value={settings.deleteMinutes} onChange={(e) => saveSettings({ ...settings, deleteMinutes: Number(e.target.value) })} className="!h-9 !w-24">
              {[1, 5, 10, 30].map((n) => <option key={n} value={n}>{n}분</option>)}
            </Select>
            <span className="text-ink-3">안에만 본인이 지울 수 있습니다. 관리자는 언제든 메시지를 가리거나 지울 수 있습니다.</span>
          </div>
        </div>
      </Card>
      {edit && <RoomEditor room={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/** 전체 자료실 볼 수 있는 사람 (대표님·관리자는 늘 볼 수 있다) */
function ArchiveAccess({ settings, onSave }: { settings: TalkSettings; onSave(s: TalkSettings): void }) {
  const { snap } = useStore();
  const members = (snap?.members ?? []).filter((m) => m.active);
  const depts = activeDepartments(snap!);
  const viewers = settings.archiveViewers ?? [];
  const top = members.filter((m) => m.isCeo || m.isAdmin);
  const granted = viewers.map((id) => members.find((m) => m.id === id)).filter(Boolean) as typeof members;
  const candidates = members.filter((m) => !m.isCeo && !m.isAdmin && !viewers.includes(m.id));
  const set = (ids: string[]) => onSave({ ...settings, archiveViewers: ids });
  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name ?? '';
  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 text-[16px] font-bold"><FolderLock size={18} className="text-brand-ink" />전체 자료실 볼 수 있는 사람</h3>
      <p className="mb-3 text-[13px] text-ink-3">소통 &gt; 자료실의 [전체 사진]·[전체 파일]은 모든 채팅방(1:1 대화 제외)과 일일·주간보고에 올라온 사진과 파일을 한곳에서 봅니다. 대표님과 관리자는 늘 볼 수 있고, 여기에 넣은 사람도 볼 수 있습니다. [현장 서류]는 지금처럼 현장방 인원이 봅니다.</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {top.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-line bg-sunken py-0.5 pl-0.5 pr-2.5 text-[13px] font-semibold text-ink-2">
            <Avatar id={m.id} name={m.name} size={22} />{m.name}<span className="font-normal text-ink-3">{m.isCeo ? '대표' : '관리자'} · 늘 볼 수 있음</span>
          </span>
        ))}
        {granted.map((m) => (
          <span key={m.id} className="flex items-center gap-1.5 rounded-full border border-brand bg-brand py-0.5 pl-0.5 pr-1 text-[13px] font-semibold text-on-brand">
            <Avatar id={m.id} name={m.name} size={22} />{m.name}<span className="font-normal text-on-brand/80">{m.title}</span>
            <button aria-label={`${m.name} 권한 빼기`} onClick={() => set(viewers.filter((x) => x !== m.id))} className="ml-0.5 rounded-full p-0.5 hover:bg-white/20"><X size={14} /></button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Select value="" onChange={(e) => e.target.value && set([...viewers, e.target.value])} className="!h-9 !w-auto min-w-[220px] text-[13px]" aria-label="볼 수 있는 사람 추가">
          <option value="">+ 사람 추가…</option>
          {[{ id: null as string | null, name: '부서 없음' }, ...depts].map((d) => {
            const list = candidates.filter((m) => m.departmentId === d.id);
            return list.length ? <optgroup key={d.id ?? 'none'} label={d.name}>{list.map((m) => <option key={m.id} value={m.id}>{m.name} {m.title}</option>)}</optgroup> : null;
          })}
        </Select>
        {granted.length > 0 && <span className="text-[12.5px] text-ink-3">{granted.length}명에게 권한을 주었습니다{granted.some((m) => m.departmentId) ? ` (${[...new Set(granted.map((m) => deptName(m.departmentId)).filter(Boolean))].join(', ')})` : ''}</span>}
      </div>
    </Card>
  );
}
