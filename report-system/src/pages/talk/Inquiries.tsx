import { AlertTriangle, ArrowRightCircle, ChevronLeft, MapPin, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/client';
import { INQUIRY_STAGES, INQUIRY_STALE_DAYS, type ChatRoom, type Inquiry, type InquiryStage, type RoomSummary } from '../../lib/talkTypes';
import { relativeTime } from '../../lib/week';
import { useStore } from '../../state/store';
import { Badge, Button, Card, cx, Empty, Field, Input, Modal, Select, Spinner } from '../../components/ui';
import { Conversation } from './Chat';
import { refreshTalk } from './useTalk';

const stageLabel = (s: InquiryStage) => INQUIRY_STAGES.find((x) => x.id === s)?.label ?? s;
const isOpen = (q: Inquiry) => INQUIRY_STAGES.find((x) => x.id === q.stage)?.open ?? false;
export const staleDays = (q: Inquiry) => Math.floor((Date.now() - Date.parse(q.lastActivityAt)) / 86400000);
const stageTone = (s: InquiryStage) => (s === 'won' || s === 'closed' ? 'ok' : s === 'lost' ? 'neutral' : s === 'hold' ? 'warn' : s === 'proposal' ? 'brand' : 'note') as 'ok' | 'neutral' | 'warn' | 'brand' | 'note';

/** 신규 교회건축 문의방: 문의 카드(단계·담당자) + 카드별 대화 */
export function InquiryBoard({ room, summary, inquiries, onRoom }: { room: ChatRoom; summary: RoomSummary; inquiries: Inquiry[]; onRoom(id: string): void }) {
  const { snap } = useStore();
  const [filter, setFilter] = useState<InquiryStage | 'open' | 'all'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Inquiry | 'new' | null>(null);
  const opened = inquiries.find((q) => q.id === openId);
  if (opened) return <InquiryDetail q={opened} room={room} summary={summary} onBack={() => setOpenId(null)} onEdit={() => setEdit(opened)} onRoom={onRoom} editing={edit} closeEdit={() => setEdit(null)} />;

  const list = inquiries
    .filter((q) => (filter === 'all' ? true : filter === 'open' ? isOpen(q) : q.stage === filter))
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.lastActivityAt.localeCompare(a.lastActivityAt));
  const count = (s: InquiryStage) => inquiries.filter((q) => q.stage === s).length;
  const members = new Map((snap?.members ?? []).map((m) => [m.id, m]));
  return (
    <div className="h-full overflow-y-auto px-3 py-3 scrollbar-thin sm:px-5">
      <div className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {INQUIRY_STAGES.map((s) => (
          <button key={s.id} onClick={() => setFilter(filter === s.id ? 'open' : s.id)}
            className={cx('rounded-xl border px-2 py-2 text-center', filter === s.id ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-line-strong')}>
            <p className="text-[18px] font-extrabold leading-none tabular">{count(s.id)}</p>
            <p className="mt-1 text-[11.5px] font-semibold text-ink-3">{s.label}</p>
          </button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex gap-1">
          {([['open', '진행 중'], ['all', '전체']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', filter === id ? 'bg-ink text-bg' : 'bg-sunken text-ink-2')}>{label}</button>
          ))}
        </div>
        <Button size="sm" tone="primary" className="ml-auto" onClick={() => setEdit('new')}><Plus size={15} />새 문의</Button>
      </div>
      {!list.length && <Empty title="해당하는 문의가 없습니다" />}
      <div className="grid gap-2.5 xl:grid-cols-2">
        {list.map((q) => {
          const idle = staleDays(q);
          const stale = isOpen(q) && idle >= INQUIRY_STALE_DAYS;
          const owner = q.ownerId ? members.get(q.ownerId) : null;
          return (
            <Card key={q.id} className={cx('p-3.5', stale && 'ring-2 ring-danger/40')} onClick={() => setOpenId(q.id)}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">{q.church}</p>
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] text-ink-3"><MapPin size={12} />{q.region || '지역 미정'} · {q.scale || '규모 미정'}</p>
                </div>
                <Badge tone={stageTone(q.stage)}>{stageLabel(q.stage)}</Badge>
              </div>
              <div className="mt-2.5 flex items-center gap-2 text-[12px]">
                <span className={cx('flex items-center gap-1 font-semibold', owner ? 'text-ink-2' : 'text-danger')}><UserRound size={12} />{owner ? owner.name : '담당자 없음'}</span>
                <span className="text-ink-3">· {q.source}</span>
                <span className={cx('ml-auto', stale ? 'flex items-center gap-1 font-bold text-danger' : 'text-ink-3')}>
                  {stale && <AlertTriangle size={12} />}{stale ? `${idle}일째 진행 없음` : relativeTime(q.lastActivityAt)}
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-[12px] text-ink-3">진행 중인 문의가 {INQUIRY_STALE_DAYS}일 동안 진행이 없으면 담당자에게 알림이 갑니다.</p>
      {edit && <InquiryEditor q={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(q) => { setEdit(null); setOpenId(q.id); }} />}
    </div>
  );
}

function InquiryDetail({ q, room, summary, onBack, onEdit, onRoom, editing, closeEdit }: {
  q: Inquiry; room: ChatRoom; summary: RoomSummary; onBack(): void; onEdit(): void; onRoom(id: string): void; editing: Inquiry | 'new' | null; closeEdit(): void;
}) {
  const { me, snap, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const people = (snap?.members ?? []).filter((m) => room.memberIds.includes(m.id) && m.active);
  const save = async (patch: Partial<Inquiry>) => {
    try { await api.talk.inquiries.save({ ...q, ...patch }); await refreshTalk(); } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); }
  };
  const toSite = async () => {
    if (!confirm(`'${q.church}'을(를) 영업 단계 현장으로 등록할까요? 대시보드 현장 목록에 나타납니다.`)) return;
    setBusy(true);
    try { const s = await api.talk.inquiries.toSite(q.id); await refreshTalk(); toast(`'${s.name}' 영업 현장으로 등록했습니다.`); } catch (e) { toast(e instanceof Error ? e.message : '등록하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  const idle = staleDays(q);
  const stale = isOpen(q) && idle >= INQUIRY_STALE_DAYS;
  const rows: [string, string][] = [['지역', q.region], ['담당(교회)', q.contactName], ['연락처', q.phone], ['규모', q.scale], ['예산', q.budget], ['희망 시기', q.timing], ['유입 경로', q.source]];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[52%] shrink-0 overflow-y-auto border-b border-line bg-surface px-3 py-3 scrollbar-thin sm:px-5">
        <div className="flex items-center gap-2">
          <Button size="sm" tone="ghost" onClick={onBack}><ChevronLeft size={16} />목록</Button>
          <p className="min-w-0 flex-1 truncate text-[16px] font-extrabold">{q.church}</p>
          <Button size="sm" onClick={onEdit}><Pencil size={14} />정보</Button>
          {(me.isCeo || me.isAdmin) && <Button size="sm" tone="ghost" onClick={() => { if (confirm('이 문의와 대화를 지울까요?')) void api.talk.inquiries.remove(q.id).then(() => { onBack(); return refreshTalk(); }); }}><Trash2 size={14} /></Button>}
        </div>
        {stale && <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] font-semibold text-danger"><AlertTriangle size={14} />{idle}일째 진행이 없습니다. 담당자에게 알림이 갑니다.</p>}
        <div className="mt-3 flex flex-wrap gap-1">
          {INQUIRY_STAGES.map((s) => (
            <button key={s.id} onClick={() => s.id !== q.stage && void save({ stage: s.id })}
              className={cx('rounded-full border px-2.5 py-1 text-[12.5px] font-semibold', q.stage === s.id ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-ink-2 hover:border-brand')}>{s.label}</button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink-2">담당자</span>
          <Select value={q.ownerId ?? ''} onChange={(e) => void save({ ownerId: e.target.value || null })} className="!h-9 !w-auto text-[13px]">
            <option value="">지정 안 함</option>
            {people.map((m) => <option key={m.id} value={m.id}>{m.name} {m.title}</option>)}
          </Select>
          {(me.isCeo || me.isAdmin) && !q.siteId && ['proposal', 'won'].includes(q.stage) && (
            <Button size="sm" tone="primary" disabled={busy} onClick={() => void toSite()}>{busy ? <Spinner /> : <ArrowRightCircle size={15} />}영업 현장으로 넘기기</Button>
          )}
          {q.siteId && <Badge tone="ok">영업 현장 등록됨</Badge>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k} className="min-w-0"><dt className="text-[11.5px] font-semibold text-ink-3">{k}</dt><dd className="truncate">{v || '-'}</dd></div>
          ))}
        </dl>
        {q.note && <p className="mt-2 whitespace-pre-line text-[13px] text-ink-2">{q.note}</p>}
        <p className="mt-2 text-[11.5px] text-ink-3">연락처는 이 문의방 인원에게만 보입니다.</p>
      </div>
      <div className="min-h-0 flex-1"><Conversation summary={summary} inquiryId={q.id} onRoom={onRoom} /></div>
      {editing && editing !== 'new' && <InquiryEditor q={editing} onClose={closeEdit} onSaved={closeEdit} />}
    </div>
  );
}

function InquiryEditor({ q, onClose, onSaved }: { q: Inquiry | null; onClose(): void; onSaved(q: Inquiry): void }) {
  const { me, toast } = useStore();
  const blank: Inquiry = { id: `inq_${Date.now().toString(36)}`, church: '', region: '', contactName: '', phone: '', scale: '', budget: '', timing: '', source: '전화 문의', stage: 'new', ownerId: null, note: '', createdBy: me.id, createdAt: '', updatedAt: '', lastActivityAt: '', siteId: null };
  const [f, setF] = useState<Inquiry>(q ?? blank);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Inquiry) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try { const saved = await api.talk.inquiries.save(f); await refreshTalk(); onSaved(saved); } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={q ? '문의 정보 고치기' : '새 문의 등록'} width={560}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !f.church.trim()} onClick={() => void save()}>{busy && <Spinner />}저장</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="교회 이름"><Input autoFocus value={f.church} onChange={set('church')} /></Field>
        <Field label="지역"><Input value={f.region} onChange={set('region')} placeholder="예: 경기 남부" /></Field>
        <Field label="담당자 (교회 측)"><Input value={f.contactName} onChange={set('contactName')} placeholder="예: 담임목사, 건축위원장" /></Field>
        <Field label="연락처"><Input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
        <Field label="규모"><Input value={f.scale} onChange={set('scale')} placeholder="예: 예배당 400석, 부지 1,200평" /></Field>
        <Field label="예산"><Input value={f.budget} onChange={set('budget')} /></Field>
        <Field label="희망 시기"><Input value={f.timing} onChange={set('timing')} /></Field>
        <Field label="유입 경로">
          <Select value={f.source} onChange={set('source')}>
            {['전화 문의', '홈페이지 문의', '소개 (기존 건축주)', '소개 (지인)', '박람회', '기타'].map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="메모"><textarea value={f.note} onChange={set('note')} rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] focus:border-brand focus:outline-none" /></Field></div>
      </div>
    </Modal>
  );
}
