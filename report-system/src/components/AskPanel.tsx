import { ChevronRight, Search, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { buildAskPrompt, queryTerms, rank, snippet, splitRefs, type Labeled, type Lookup } from '../lib/ask';
import { api } from '../lib/client';
import { summaryModel } from '../lib/models';
import { aiOn, useAppSettings } from '../lib/settings';
import type { AskAnswer, SearchDoc } from '../lib/types';
import { shiftDay, todayIso } from '../lib/week';
import { useStore } from '../state/store';
import { TextBlock } from './editors';
import { Badge, Button, Card, cx, Modal, Segmented, Spinner } from './ui';

type Period = '7' | '31' | '92' | '0';
type Kind = 'all' | 'weekly' | 'daily';
const PERIOD_LABEL: Record<Period, string> = { '7': '최근 1주', '31': '최근 1개월', '92': '최근 3개월', '0': '전체 기간' };
const SUGGEST = ['미완료 지시사항 정리해줘', '이번 주 이슈 있는 현장 알려줘', '지난주보다 크게 바뀐 현장은?', '최근 안전 관련 내용 정리해줘'];

interface Result { question: string; matches: Labeled[]; byRef: Map<string, Labeled>; ai: AskAnswer | null; aiError: string | null; sent: number; total: number; partial: boolean }

/** 대표님 대시보드 맨 위 검색창: 보고 원문 검색 + AI 답변(출처 포함) */
export function AskPanel() {
  const { snap } = useStore();
  const settings = useAppSettings();
  const aiEnabled = aiOn(settings, 'ask');
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('31');
  const [kind, setKind] = useState<Kind>('all');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [open, setOpen] = useState<Labeled | null>(null);
  const cache = useRef(new Map<string, SearchDoc[]>());
  const lookup = useMemo<Lookup | null>(() => (snap ? {
    sites: new Map(snap.sites.map((s) => [s.id, s])),
    members: new Map(snap.members.map((m) => [m.id, m])),
    departments: new Map(snap.departments.map((d) => [d.id, d])),
  } : null), [snap]);
  if (!lookup) return null;

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setRes(null);
    try {
      const from = period === '0' ? '2000-01-01' : shiftDay(todayIso(), -Number(period));
      let docs = cache.current.get(from);
      if (!docs) { docs = await api.ask.corpus(from); cache.current.set(from, docs); }
      const pool = docs.filter((d) => kind === 'all' || (kind === 'daily' ? d.kind === 'daily' : d.kind !== 'daily'));
      const ranked = rank(pool, text, lookup);
      const byRef = new Map(ranked.map((d) => [d.ref, d]));
      const matches = ranked.filter((d) => d.score > 0).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 30);
      const base = { question: text, matches, byRef, total: pool.length };
      if (!pool.length) { setRes({ ...base, ai: null, aiError: '이 기간에 보고가 없습니다.', sent: 0, partial: false }); return; }
      if (!aiEnabled) { setRes({ ...base, ai: null, aiError: null, sent: 0, partial: false }); return; }
      const { prompt, sent, partial } = buildAskPrompt(text, ranked, `${PERIOD_LABEL[period]} · ${kind === 'all' ? '주간+일일' : kind === 'weekly' ? '주간보고' : '일일보고'}`);
      setRes({ ...base, ai: null, aiError: null, sent: sent.length, partial });
      try {
        const ai = await api.ask.answer(prompt);
        setRes({ ...base, ai, aiError: null, sent: sent.length, partial });
      } catch (e) {
        setRes({ ...base, ai: null, aiError: e instanceof Error ? e.message : 'AI 답변을 받지 못했습니다.', sent: sent.length, partial });
      }
    } catch (e) {
      setRes({ question: text, matches: [], byRef: new Map(), ai: null, aiError: e instanceof Error ? e.message : '불러오지 못했습니다.', sent: 0, total: 0, partial: false });
    } finally {
      setBusy(false);
    }
  };
  const terms = res ? queryTerms(res.question) : [];

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <div className="relative min-w-0 flex-1">
          <Sparkles size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-brand" />
          <input id="ask-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={aiEnabled ? '무엇이든 물어보세요 · 예: 가나다교회 레미콘 관련 내용 정리해줘' : '보고 검색 · 예: 가나다교회 레미콘'}
            className="h-12 w-full rounded-xl border border-line-strong bg-surface pl-10 pr-3 text-[15px] placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10" />
        </div>
        <Button tone="primary" type="submit" disabled={busy || !q.trim()} className="!h-12 !px-5">{busy ? <Spinner /> : <Search size={17} />}{aiEnabled ? '묻기' : '검색'}</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented<Period> value={period} onChange={(v) => setPeriod(v)} options={[{ id: '7', label: '1주' }, { id: '31', label: '1개월' }, { id: '92', label: '3개월' }, { id: '0', label: '전체' }]} />
        <Segmented<Kind> value={kind} onChange={(v) => setKind(v)} options={[{ id: 'all', label: '주간+일일' }, { id: 'weekly', label: '주간' }, { id: 'daily', label: '일일' }]} />
      </div>
      {!res && !busy && aiEnabled && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGEST.map((s) => (
            <button key={s} type="button" onClick={() => void ask(s)} className="rounded-full border border-line-strong bg-surface px-3 py-1 text-[12.5px] font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">{s}</button>
          ))}
        </div>
      )}

      {res && (
        <div className={cx('mt-4 grid gap-4', aiEnabled && 'lg:grid-cols-[1.25fr_1fr]')}>
          {aiEnabled && <section className="rounded-xl border border-brand/25 bg-brand-soft/50 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-bold"><Sparkles size={15} className="text-brand" />AI 답변</h3>
            {res.ai ? (
              <>
                <div className="space-y-1 text-[14px] leading-[1.7]">
                  {res.ai.answer.split('\n').filter((l) => l.trim()).map((line, i) => (
                    <p key={i}>{splitRefs(line).map((part, j) => typeof part === 'string' ? <span key={j}>{part}</span> : (
                      <button key={j} type="button" onClick={() => { const d = res.byRef.get(part.ref); if (d) setOpen(d); }}
                        className="mx-0.5 rounded bg-surface px-1 text-[11.5px] font-bold text-brand-ink ring-1 ring-brand/30 hover:bg-brand hover:text-on-brand">{part.ref}</button>
                    ))}</p>
                  ))}
                </div>
                {res.ai.sourceIds.length > 0 && (
                  <div className="mt-3 border-t border-brand/20 pt-2.5">
                    <p className="mb-1 text-[12px] font-bold text-ink-3">출처</p>
                    <ul className="space-y-0.5">
                      {res.ai.sourceIds.map((r) => res.byRef.get(r)).filter(Boolean).map((d) => (
                        <li key={d!.ref}><button type="button" onClick={() => setOpen(d!)} className="text-left text-[12.5px] text-ink-2 hover:text-brand-ink hover:underline"><b className="mr-1 text-brand-ink">{d!.ref}</b>{d!.label}</button></li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2.5 text-[11.5px] text-ink-3">{summaryModel(res.ai.model).name} · 보고 {res.total}건 중 {res.sent}건 참고{res.partial && '(관련 높은 것만)'} · AI 답변은 틀릴 수 있으니 출처를 눌러 원문을 확인하세요</p>
              </>
            ) : res.aiError ? <p className="text-[13.5px] text-ink-2">{res.aiError}</p> : <p className="flex items-center gap-2 text-[13.5px] text-ink-3"><Spinner />보고 {res.sent}건을 읽고 답을 정리하는 중</p>}
          </section>}

          <section>
            <h3 className="mb-2 text-[14px] font-bold">관련 보고 원문 <span className="text-ink-3">{res.matches.length}건</span></h3>
            {res.matches.length === 0 ? <p className="text-[13px] text-ink-3">검색어가 들어간 보고가 없습니다. 기간을 넓히거나 다른 말로 찾아보세요.</p> : (
              <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {res.matches.map((d) => (
                  <li key={d.ref}>
                    <button type="button" onClick={() => setOpen(d)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-left hover:border-line-strong hover:bg-sunken/60">
                      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-3">
                        <Badge tone={d.kind === 'daily' ? 'neutral' : d.kind === 'directive' ? 'note' : 'brand'}>{d.kind === 'daily' ? '일일' : d.kind === 'directive' ? '지시' : '주간'}</Badge>
                        <span className="truncate">{d.label}</span>
                      </span>
                      <span className="mt-1 block text-[13px] leading-[1.55] text-ink-2">{highlight(snippet(d.content, terms), terms)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {open && <DocModal doc={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).map((part, i) => (terms.includes(part) ? <mark key={i} className="rounded bg-em-hl px-0.5 text-ink">{part}</mark> : part));
}

/** 출처 원문 보기. 주간보고·지시는 그 주 보고 화면으로 이동할 수 있다 */
function DocModal({ doc, onClose }: { doc: Labeled; onClose(): void }) {
  const { setWeekId, openDrawer, setView } = useStore();
  const go = () => {
    onClose();
    setView('dashboard');
    setWeekId(doc.date);
    if (doc.siteId) openDrawer({ type: 'site', id: doc.siteId });
    else if (doc.memberId) openDrawer({ type: 'person', id: doc.memberId });
  };
  return (
    <Modal open onClose={onClose} title={`${doc.ref} · ${doc.kind === 'daily' ? '일일보고' : doc.kind === 'directive' ? '대표 지시' : '주간보고'}`} width={600}
      footer={<>{doc.kind !== 'daily' && <Button onClick={go}>그 주 보고 열기<ChevronRight size={15} /></Button>}<Button tone="primary" onClick={onClose}>닫기</Button></>}>
      <p className={cx('mb-3 text-[13px] font-semibold text-ink-3')}>{doc.label}</p>
      <TextBlock text={doc.content} />
    </Modal>
  );
}
