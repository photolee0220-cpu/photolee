import { AlertTriangle, Download, FileText, Megaphone, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/client';
import { pdfThumb, renderPdfPages } from '../../lib/pdfPages';
import type { ChatRoom, Minutes } from '../../lib/talkTypes';
import { dayLabel, dowOf, shiftDay, todayIso } from '../../lib/week';
import { useStore } from '../../state/store';
import { Button, Card, cx, Empty, Field, IconButton, Input, Modal, Spinner } from '../../components/ui';
import { refreshTalk } from './useTalk';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 가장 최근 정기회의 날 (오늘 포함) */
export function lastMeetingDate(dow: number, today = todayIso()): string {
  const back = (dowOf(today) - dow + 7) % 7;
  return shiftDay(today, -back);
}

/** 정기회의 다음 날부터 그 회의 회의록이 없으면 '미등록' */
export function minutesMissing(room: ChatRoom, minutes: Minutes[], today = todayIso()): string | null {
  if (room.meetingDow == null || !room.siteId) return null;
  const last = lastMeetingDate(room.meetingDow, today);
  if (last === today) return null;
  return minutes.some((m) => m.siteId === room.siteId && m.meetingDate >= last) ? null : last;
}

/** 현장방 [회의록] 칸: 매주 감리단·협력업체와 하는 정기회의 회의록 (PDF는 그림으로 보여 준다) */
export function MinutesTab({ room, minutes }: { room: ChatRoom; minutes: Minutes[] }) {
  const { toast } = useStore();
  const [upload, setUpload] = useState(false);
  const [view, setView] = useState<Minutes | null>(null);
  const [busy, setBusy] = useState(false);
  const missing = minutesMissing(room, minutes);
  const request = async () => {
    setBusy(true);
    try { await api.talk.minutes.request(room.siteId!); await refreshTalk(); toast('현장방에 회의록 요청을 남기고 알림을 보냈습니다.'); } catch (e) { toast(e instanceof Error ? e.message : '요청하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="h-full overflow-y-auto px-3 py-3 scrollbar-thin sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink-2">{room.meetingDow != null ? <>정기회의 <b>매주 {DOW[room.meetingDow]}요일</b> · 감리단·협력업체 회의록을 올려 주세요</> : '정기회의 요일이 정해지지 않았습니다 (관리자가 방 관리에서 정합니다)'}</p>
        <Button size="sm" tone="primary" className="ml-auto" onClick={() => setUpload(true)}><Upload size={15} />회의록 올리기</Button>
      </div>
      {missing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5">
          <AlertTriangle size={16} className="shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-[13px] font-semibold">{dayLabel(missing)} 정기회의 회의록이 아직 없습니다.</p>
          <Button size="sm" disabled={busy} onClick={() => void request()}>{busy ? <Spinner /> : <Megaphone size={14} />}회의록 요청</Button>
        </div>
      )}
      {!minutes.length && <Empty title="올라온 회의록이 없습니다">PDF나 회의록 사진을 올리면 휴대폰에서도 그림으로 바로 보입니다.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {minutes.map((m) => <MinutesCard key={m.id} m={m} onOpen={() => setView(m)} />)}
      </div>
      {upload && <UploadModal room={room} defaultDate={room.meetingDow != null ? lastMeetingDate(room.meetingDow) : todayIso()} onClose={() => setUpload(false)} />}
      {view && <MinutesViewer m={view} onClose={() => setView(null)} />}
    </div>
  );
}

function MinutesCard({ m, onOpen }: { m: Minutes; onOpen(): void }) {
  const { snap } = useStore();
  const [thumb, setThumb] = useState<string | null>(m.fileType === 'image' ? m.url : null);
  useEffect(() => {
    if (m.fileType !== 'pdf') return;
    let alive = true;
    pdfThumb(m.url).then((t) => { if (alive) setThumb(t); }).catch(() => undefined);
    return () => { alive = false; };
  }, [m.url, m.fileType]);
  const who = snap?.members.find((x) => x.id === m.uploadedBy);
  return (
    <Card className="overflow-hidden" onClick={onOpen}>
      <div className="flex h-40 items-start justify-center overflow-hidden bg-sunken">
        {thumb ? <img src={thumb} alt="" className="w-full object-cover object-top" /> : <div className="flex h-full items-center"><FileText size={28} className="text-ink-3" /></div>}
      </div>
      <div className="p-3">
        <p className="truncate text-[14px] font-bold">{m.title}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">{dayLabel(m.meetingDate)} · {who?.name ?? ''}</p>
        {m.note && <p className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{m.note}</p>}
      </div>
    </Card>
  );
}

function UploadModal({ room, defaultDate, onClose }: { room: ChatRoom; defaultDate: string; onClose(): void }) {
  const { toast } = useStore();
  const [date, setDate] = useState(defaultDate);
  const [title, setTitle] = useState('주간 공정회의 (감리단·협력업체)');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api.talk.minutes.upload({ siteId: room.siteId!, meetingDate: date, title, note, file });
      await refreshTalk();
      toast('회의록을 올렸습니다.');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : '올리지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="회의록 올리기" width={480}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !file} onClick={() => void save()}>{busy && <Spinner />}올리기</Button></>}>
      <div className="space-y-3">
        <button onClick={() => input.current?.click()} className={cx('flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center', file ? 'border-brand bg-brand-soft/50' : 'border-line-strong hover:border-brand')}>
          <Upload size={22} className="text-brand" />
          <span className="text-[14px] font-bold">{file ? file.name : 'PDF 또는 사진 고르기'}</span>
          <span className="text-[12px] text-ink-3">PDF는 쪽마다 그림으로 보여 줍니다. 종이 회의록은 사진을 찍어 올려도 됩니다.</span>
        </button>
        <input ref={input} type="file" hidden accept="application/pdf,image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <Field label="회의한 날"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="제목"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="한 줄 메모 (선택)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 감리 지적 3건, 타설 일정 확정" /></Field>
      </div>
    </Modal>
  );
}

/** 회의록 보기: PDF 쪽을 그림으로 차례로 보여 준다 */
function MinutesViewer({ m, onClose }: { m: Minutes; onClose(): void }) {
  const { me, toast } = useStore();
  const [pages, setPages] = useState<string[]>(m.fileType === 'image' ? [m.url] : []);
  const [total, setTotal] = useState<number | null>(m.fileType === 'image' ? 1 : null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (m.fileType !== 'pdf') return;
    let alive = true;
    const width = Math.min(1600, Math.round(Math.min(window.innerWidth, 900) * (window.devicePixelRatio || 1)));
    renderPdfPages(m.url, width, (i, t, img) => { if (!alive) return; setTotal(t); setPages((p) => { const n = [...p]; n[i] = img; return n; }); })
      .catch(() => alive && setErr('PDF를 그림으로 바꾸지 못했습니다. 원본 내려받기로 열어 보세요.'));
    return () => { alive = false; };
  }, [m.url, m.fileType]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/90" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="flex items-center gap-2 px-3 py-2 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{m.title}</p>
          <p className="text-[12px] text-white/70">{dayLabel(m.meetingDate)}{total ? ` · ${total}쪽` : ''}</p>
        </div>
        <a href={m.url} download={m.fileName} className="flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-[13px] font-semibold hover:bg-white/25"><Download size={15} />원본</a>
        {(m.uploadedBy === me.id || me.isAdmin || me.isCeo) && (
          <IconButton label="지우기" className="!text-white hover:!bg-white/15" onClick={() => {
            if (!confirm('이 회의록을 지울까요?')) return;
            void api.talk.minutes.remove(m.id).then(() => { onClose(); return refreshTalk(); }).catch((e) => toast(e.message, 'error'));
          }}><Trash2 size={17} /></IconButton>
        )}
        <button onClick={onClose} className="flex h-9 items-center rounded-lg bg-white/15 px-3 text-[13px] font-semibold hover:bg-white/25">닫기</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 sm:px-6">
        <div className="mx-auto max-w-[900px] space-y-3">
          {pages.map((src, i) => src && <img key={i} src={src} alt={`${i + 1}쪽`} className="w-full rounded-md bg-white shadow-lg" />)}
          {err && <p className="py-10 text-center text-[14px] text-white/80">{err}</p>}
          {!err && (total == null || pages.filter(Boolean).length < total) && <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-white" /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
