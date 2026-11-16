import { ChevronDown, ChevronRight, ShieldAlert, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/client';
import type { SafetyTip } from '../../lib/talkTypes';
import { todayIso } from '../../lib/week';
import { useStore } from '../../state/store';
import { Badge, Button, Card, cx, Spinner } from '../../components/ui';
import { refreshTalk, talkAvailable, useTalk } from './useTalk';

/** 대표님 대시보드: 오늘 보고·앞으로 3일 일정에서 위험 작업을 찾아 '안전 당부' 문장을 만들어 둔다.
 *  대표님이 고쳐서 안전방·현장방으로 보내면 기록으로 남는다 */
export function SafetyCard() {
  const { me, snap, toast } = useStore();
  const { data } = useTalk();
  const [tips, setTips] = useState<SafetyTip[] | null>(null);
  const [open, setOpen] = useState(true);
  const date = todayIso();
  const [busy, setBusy] = useState(false);
  const load = (refresh = false) => {
    setBusy(true);
    api.talk.safety.suggestions(date, refresh).then(setTips).catch(() => setTips([])).finally(() => setBusy(false));
  };
  useEffect(() => load(), [date]);
  if (!me.isCeo || !talkAvailable() || !tips || !tips.some((t) => t.status === 'new')) return null;
  const pending = tips.filter((t) => t.status === 'new');
  const sites = new Map((snap?.sites ?? []).map((s) => [s.id, s]));
  return (
    <Card className="mb-6 border-danger/30 p-4 sm:p-5">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <ShieldAlert size={18} className="text-danger" />
        <span className="text-[15.5px] font-bold">안전 전달 제안</span>
        <Badge tone="danger">{pending.length}건</Badge>
        <span className="hidden text-[12.5px] text-ink-3 sm:inline">어제·오늘 현장 보고와 앞으로 3일 일정에서 찾았습니다</span>
        <span className="ml-auto text-ink-3">{open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {pending.map((t) => (
            <TipBox key={t.id} tip={t} siteName={sites.get(t.siteId)?.name ?? '현장'} rooms={(data?.rooms ?? []).map((r) => r.room).filter((r) => r.kind === 'safety' || (r.kind === 'site' && r.siteId === t.siteId))}
              onDone={(msg) => { toast(msg); load(); void refreshTalk(); }} />
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[11.5px] text-ink-3">보고에서 위험 작업을 찾아 만든 초안입니다 (AI를 켜 두면 AI가 씁니다). 고쳐서 보내세요. 보낸 내용은 방에 기록으로 남습니다.</p>
        <Button size="sm" tone="ghost" disabled={busy} onClick={() => load(true)}>{busy ? <Spinner /> : null}다시 찾기</Button>
      </div>
    </Card>
  );
}

function TipBox({ tip, siteName, rooms, onDone }: { tip: SafetyTip; siteName: string; rooms: { id: string; name: string; kind: string }[]; onDone(msg: string): void }) {
  const { toast } = useStore();
  const [text, setText] = useState(tip.text);
  const [to, setTo] = useState<string[]>(tip.roomIds.filter((id) => rooms.some((r) => r.id === id)));
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.talk.safety.send(tip, text, to); onDone(`${to.length}개 방에 안전 당부를 보냈습니다.`); } catch (e) { toast(e instanceof Error ? e.message : '보내지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[14px] font-bold">{siteName}</p>
        <button onClick={() => void api.talk.safety.dismiss(tip).then(() => onDone('넘겼습니다.'))} className="flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink"><X size={13} />넘기기</button>
      </div>
      <ul className="mb-2 space-y-0.5">
        {tip.sources.map((s, i) => <li key={i} className="truncate text-[12px] text-ink-3">· {s}</li>)}
      </ul>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13.5px] leading-[1.6] focus:border-brand focus:outline-none" />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold text-ink-3">보낼 방</span>
        {rooms.map((r) => {
          const on = to.includes(r.id);
          return (
            <button key={r.id} onClick={() => setTo(on ? to.filter((x) => x !== r.id) : [...to, r.id])}
              className={cx('rounded-full border px-2.5 py-0.5 text-[12.5px] font-semibold', on ? 'border-danger bg-danger text-white' : 'border-line-strong text-ink-2 hover:border-danger')}>
              {r.name}
            </button>
          );
        })}
        {!rooms.length && <span className="text-[12px] text-ink-3">보낼 방이 없습니다 (관리자가 안전방·현장방을 만들면 생깁니다)</span>}
        <Button size="sm" tone="primary" className="ml-auto" disabled={busy || !to.length || !text.trim()} onClick={() => void send()}>{busy ? <Spinner /> : <Send size={14} />}보내기</Button>
      </div>
    </div>
  );
}
