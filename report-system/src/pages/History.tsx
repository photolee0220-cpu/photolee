import { ArrowRight, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, Card, Empty, Spinner } from '../components/ui';
import type { WeekSummary } from '../lib/api';
import { api } from '../lib/client';
import { currentWeekId, weekLabelLong } from '../lib/week';
import { defaultView, useStore } from '../state/store';
import { useExport } from './useExport';

export function HistoryPage() {
  const { me, weekId, setWeekId, setView, toast } = useStore();
  const exportWeek = useExport();
  const [weeks, setWeeks] = useState<WeekSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api.listWeeks().then(setWeeks).catch(() => setWeeks([])); }, []);
  const cur = currentWeekId();

  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeader title="지난 보고">
        <span className="text-[13px] text-ink-3">주차를 고르면 그 주의 보고를 볼 수 있습니다. 권한이 있는 범위만 보입니다.</span>
      </PageHeader>
      {!weeks ? <div className="flex justify-center py-16"><Spinner /></div> : !weeks.length ? <Empty title="아직 쌓인 보고가 없습니다" /> : (
        <div className="space-y-2">
          {weeks.map((w) => (
            <Card key={w.weekId} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-bold">
                  {weekLabelLong(w.weekId)}
                  {w.weekId === cur && <Badge tone="brand">이번 주</Badge>}
                  {w.weekId === weekId && w.weekId !== cur && <Badge>보는 중</Badge>}
                </p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">작성된 칸 {w.entryCount}개 · 작성자 {w.writers}명</p>
              </div>
              <Button size="sm" disabled={busy === w.weekId} onClick={async () => {
                setBusy(w.weekId);
                try { await exportWeek(await api.loadWeek(w.weekId)); } catch { toast('불러오지 못했습니다.', 'error'); } finally { setBusy(null); }
              }}><Download size={14} />엑셀</Button>
              <Button size="sm" tone="primary" onClick={() => { setWeekId(w.weekId); setView(defaultView(me)); }}>보기<ArrowRight size={14} /></Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
