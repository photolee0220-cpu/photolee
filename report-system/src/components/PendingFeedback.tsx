import { Check, ChevronRight, MessageSquareText, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { isReviewer } from '../lib/access';
import { api } from '../lib/client';
import type { PendingFeedback } from '../lib/types';
import { relativeTime, weekLabel } from '../lib/week';
import { useStore } from '../state/store';
import { Badge, Button, Sheet, Spinner } from './ui';

/** 확인 전 피드백(지난 주차 포함)을 불러온다. 화면 데이터가 바뀌면 다시 읽는다 */
export function usePendingFeedback() {
  const { snap, me } = useStore();
  const [list, setList] = useState<PendingFeedback[]>([]);
  const refresh = useCallback(() => {
    if (isReviewer(me) || !me.departmentId) return;
    api.pendingFeedback().then(setList).catch(() => undefined);
  }, [me]);
  useEffect(() => { refresh(); }, [refresh, snap]);
  return { list, refresh };
}

/** '이번 주 작성' 위쪽 알림 띠: 확인 전 피드백이 있으면 지난 주차 것까지 알려준다 */
export function PendingFeedbackBanner() {
  const { weekId } = useStore();
  const { list, refresh } = usePendingFeedback();
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  const older = list.filter((x) => x.entry.weekId !== weekId).length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mb-4 flex w-full items-center gap-2.5 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-left text-[13.5px] font-semibold text-brand-ink hover:border-brand/60">
        <MessageSquareText size={18} className="shrink-0" />
        <span className="flex-1">확인하지 않은 피드백 {list.length}건{older > 0 && <> (다른 주차 {older}건 포함)</>} · 눌러서 모아 보고 확인하세요</span>
        <ChevronRight size={17} className="shrink-0" />
      </button>
      {open && <PendingFeedbackSheet list={list} onChange={refresh} onClose={() => setOpen(false)} />}
    </>
  );
}

function PendingFeedbackSheet({ list, onChange, onClose }: { list: PendingFeedback[]; onChange(): void; onClose(): void }) {
  const { snap, reload, toast, setWeekId, openDrawer } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!snap) return null;
  const members = new Map(snap.members.map((m) => [m.id, m]));
  const where = (x: PendingFeedback) => (x.entry.kind === 'site' ? snap.sites.find((s) => s.id === x.entry.siteId)?.name ?? '현장' : '부서 업무보고');

  const ack = async (x: PendingFeedback) => {
    setBusy(x.comment.id);
    try {
      const reply = drafts[x.comment.id]?.trim();
      if (reply) await api.addComment(x.entry.id, reply);
      await api.acknowledgeComment(x.comment.id);
      toast(reply ? '답글을 남기고 확인했습니다' : '확인했습니다');
      onChange();
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : '처리하지 못했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };
  const go = (x: PendingFeedback) => {
    onClose();
    setWeekId(x.entry.weekId);
    if (x.entry.kind === 'site' && x.entry.siteId) openDrawer({ type: 'site', id: x.entry.siteId });
  };

  return (
    <Sheet open onClose={onClose} title="확인할 피드백" subtitle={`${list.length}건 · 지난 주차 보고에 남긴 피드백도 여기서 확인합니다`} width={600}>
      {list.length === 0 ? <p className="py-6 text-center text-[13px] text-ink-3">모두 확인했습니다</p> : (
        <div className="space-y-3">
          {list.map((x) => {
            const a = members.get(x.comment.authorId);
            return (
              <article key={x.comment.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{weekLabel(x.entry.weekId)}</Badge>
                  <button type="button" onClick={() => go(x)} className="inline-flex items-center gap-0.5 text-[13.5px] font-bold text-brand-ink hover:underline">
                    {where(x)}<ChevronRight size={14} />
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65]">{x.comment.content}</p>
                <p className="mt-1 text-[12px] text-ink-3">{a?.isCeo ? '대표님' : `${a?.name ?? ''} ${a?.title ?? ''}`} · {relativeTime(x.comment.createdAt)}</p>
                <div className="mt-3 flex items-end gap-2">
                  <textarea value={drafts[x.comment.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [x.comment.id]: e.target.value }))} rows={1}
                    placeholder="답글 (선택)" aria-label="답글"
                    className="min-h-[40px] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13.5px] placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
                  <Button tone="primary" onClick={() => ack(x)} disabled={busy === x.comment.id}>
                    {busy === x.comment.id ? <Spinner /> : drafts[x.comment.id]?.trim() ? <Send size={15} /> : <Check size={15} />}
                    {drafts[x.comment.id]?.trim() ? '답글·확인' : '확인했습니다'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
