import { ClipboardCheck, Info } from 'lucide-react';
import { useState } from 'react';
import { writesDaily, writesWeekly } from '../lib/access';
import { api } from '../lib/client';
import { useStore } from '../state/store';
import { Button, Spinner } from './ui';
import { DEFAULT_REPORT_NOTICE, useAppSettings } from '../lib/settings';

/** 보고 칸 아래 안내 (허위 보고 관련). 관리자가 문구를 바꾸거나 비울 수 있다 */
export function ReportNotice({ className = '' }: { className?: string }) {
  const s = useAppSettings();
  const text = (s?.reportNotice ?? DEFAULT_REPORT_NOTICE).trim();
  if (!text) return null;
  return (
    <p className={`flex items-start gap-1.5 text-[12px] leading-[1.6] text-ink-3 ${className}`}>
      <Info size={13} className="mt-[3px] shrink-0" />{text}
    </p>
  );
}

/** 업무보고 작성 안내: 보고를 쓰는 직원이 처음 들어오면(또는 관리자가 다시 확인받기를 하면) 한 번 [확인]을 받는다 */
export function NoticeAckGate() {
  const { me, snap, toast } = useStore();
  const s = useAppSettings();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (!s || !snap || done || !s.ackEnabled) return null;
  const writer = writesDaily(me) || writesWeekly(me, snap.departments);
  if (!writer || (me.noticeAckVersion ?? 0) >= (s.noticeVersion ?? 1)) return null;
  const notice = (s.reportNotice ?? DEFAULT_REPORT_NOTICE).trim();
  const internal = snap.departments.find((d) => d.id === me.departmentId && d.internalReport && d.headId !== me.id);
  const ack = async () => {
    setBusy(true);
    try { await api.ackNotice(); setDone(true); toast('확인했습니다'); } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 px-4 animate-fade-in" role="dialog" aria-modal="true" aria-labelledby="ack-title">
      <div className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <p id="ack-title" className="flex items-center gap-2 text-[18px] font-extrabold"><ClipboardCheck size={22} className="text-brand" />업무보고 작성 안내</p>
        <p className="mt-1 text-[13.5px] text-ink-3">처음 한 번만 확인하면 됩니다.</p>
        <ul className="mt-4 space-y-2 text-[14.5px] leading-[1.65]">
          <li className="flex gap-2"><span className="font-bold text-brand">1</span><span>보고는 <b>사실에 근거해</b> 정해진 기한까지 작성합니다. 일일보고는 그날 안에{writesWeekly(me, snap.departments) ? ', 주간보고는 토요일 오전 10시까지' : ''} 씁니다.</span></li>
          <li className="flex gap-2"><span className="font-bold text-brand">2</span><span>작성한 보고는 {internal ? '부서장' : '대표님'}께 바로 전달되며, <b>작성·수정 기록이 모두 저장</b>됩니다.</span></li>
          <li className="flex gap-2"><span className="font-bold text-brand">3</span><span>실수로 잘못 쓴 내용은 <b>알게 된 즉시 바로잡아</b> 주세요.</span></li>
          <li className="flex gap-2"><span className="font-bold text-brand">4</span><span>연차·출장 등으로 쓰지 못하는 날은 <b>근무 상태</b>를 등록해 주세요.</span></li>
        </ul>
        {notice && <p className="mt-4 rounded-xl border border-note-line bg-note px-4 py-3 text-[14px] leading-[1.65] text-ink">{notice}</p>}
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[14.5px] font-semibold">
          <input id="ack-check" type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-5 w-5 accent-brand" />
          위 내용을 읽고 확인했습니다
        </label>
        <Button tone="primary" className="mt-4 w-full justify-center" disabled={!checked || busy} onClick={() => void ack()}>{busy ? <Spinner /> : null}확인</Button>
        <p className="mt-2 text-center text-[12px] text-ink-3">확인한 날짜와 시각이 기록됩니다.</p>
      </div>
    </div>
  );
}
