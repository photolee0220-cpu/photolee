import { RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/client';
import { has } from '../lib/derive';
import { summaryModel } from '../lib/models';
import { buildSummaryPrompt, changedSites } from '../lib/summary';
import type { AiSummary } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { Badge, Button, Card, Spinner } from './ui';

/** 대표님 대시보드 맨 위: AI 핵심 5줄 + 지난주 대비 바뀐 현장 */
export function SummaryPanel() {
  const { snap, weekId, openDrawer, toast } = useStore();
  const [summary, setSummary] = useState<AiSummary | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setSummary(undefined);
    setError('');
    api.getAiSummary(weekId).then((s) => alive && setSummary(s)).catch(() => alive && setSummary(null));
    return () => { alive = false; };
  }, [weekId]);

  const changed = useMemo(() => (snap ? changedSites(snap) : []), [snap]);
  if (!snap) return null;
  const filled = snap.entries.filter((e) => has(e.content)).length;
  const staleCount = summary
    ? [...snap.entries, ...snap.directives].filter((x) => x.updatedAt && x.updatedAt > summary.generatedAt && has(x.content)).length
    : 0;
  const notes = new Map((summary?.siteChanges ?? []).map((c) => [c.siteId, c.change]));
  const siteName = (id: string) => snap.sites.find((s) => s.id === id)?.name ?? '';

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const { prompt, sourceUpdatedAt } = buildSummaryPrompt(snap);
      setSummary(await api.generateAiSummary(weekId, prompt, sourceUpdatedAt));
      toast('AI 요약을 만들었습니다');
    } catch (e) {
      setError(e instanceof Error ? e.message : '요약을 만들지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
        <Sparkles size={17} className="text-brand" />
        <h2 className="text-[16px] font-bold">AI 주간 요약</h2>
        <Badge tone="neutral">대표님만 보입니다</Badge>
        <div className="ml-auto flex items-center gap-2.5">
          {summary && !busy && (
            <span className="text-[12px] text-ink-3">
              {summary.model && `${summaryModel(summary.model).name} · `}{relativeTime(summary.generatedAt)} 작성{staleCount > 0 && <b className="ml-1 text-warn">· 이후 {staleCount}칸 수정됨</b>}
            </span>
          )}
          {summary !== undefined && (
            <Button size="sm" tone={summary ? 'secondary' : 'primary'} onClick={generate} disabled={busy || !filled}>
              {busy ? <Spinner className="h-3.5 w-3.5" /> : summary ? <RefreshCw size={14} /> : <Sparkles size={14} />}
              {busy ? '정리하는 중' : summary ? '다시 만들기' : '요약 만들기'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[1.25fr_1fr]">
        <section className="px-5 py-4 md:border-r md:border-line">
          <h3 className="mb-2.5 text-[13px] font-bold text-ink-3">이번 주 핵심 5줄</h3>
          {summary === undefined ? <Spinner /> : busy ? (
            <div className="flex items-center gap-2.5 py-3 text-[13.5px] text-ink-2">
              <Spinner />Claude가 이번 주 보고 {filled}칸을 읽고 있습니다. 1분 정도 걸립니다.
            </div>
          ) : summary ? (
            <ol className="space-y-2">
              {summary.highlights.map((h, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-[1.6]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11.5px] font-bold text-brand-ink tabular">{i + 1}</span>
                  <span>{h}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {filled ? <>버튼을 누르면 Claude가 이번 주 보고 {filled}칸을 모두 읽고 돈·일정·분쟁·결정이 필요한 일 위주로 다섯 줄로 정리합니다.</> : '아직 작성된 보고가 없습니다.'}
            </p>
          )}
          {error && <p className="mt-2.5 rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger" role="alert">{error}</p>}
        </section>

        <section className="border-t border-line px-5 py-4 md:border-t-0">
          <h3 className="mb-2.5 text-[13px] font-bold text-ink-3">지난주 대비 바뀐 현장 {snap.prevWeekId && <span className="font-semibold">{changed.length}곳</span>}</h3>
          {!snap.prevWeekId ? (
            <p className="text-[13px] leading-relaxed text-ink-3">지난주 기록이 없어 비교할 수 없습니다. 다음 주부터 자동으로 비교합니다.</p>
          ) : !changed.length ? (
            <p className="text-[13px] text-ink-3">지난주와 달라진 현장이 없습니다.</p>
          ) : (
            <ul className="-mx-2 max-h-[260px] space-y-0.5 overflow-y-auto scrollbar-thin">
              {changed.map((c) => (
                <li key={c.siteId}>
                  <button onClick={() => openDrawer({ type: 'site', id: c.siteId })} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-sunken">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold">{siteName(c.siteId)}</span>
                      <span className="shrink-0 text-[12px] font-semibold text-brand-ink">{c.addedLines}줄</span>
                    </span>
                    {notes.get(c.siteId) && <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">{notes.get(c.siteId)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="border-t border-line bg-sunken/60 px-5 py-2 text-[12px] text-ink-3">AI 요약은 틀릴 수 있습니다. 중요한 내용은 현장을 눌러 원문을 확인하세요.</p>
    </Card>
  );
}
