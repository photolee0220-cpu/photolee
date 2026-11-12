import { ChevronLeft, ChevronRight, Clock, Globe2, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { Badge, Button, Card, cx, Field, IconButton, Input, Modal, Segmented, Select, Spinner } from '../components/ui';
import { newId } from '../lib/api';
import { canEditEvent } from '../lib/access';
import { api } from '../lib/client';
import { byId, visibleSites } from '../lib/derive';
import type { CalendarEvent, CalendarScope } from '../lib/types';
import { dayLabel, parseIsoDate, shiftDay, todayIso, toIsoDate } from '../lib/week';
import { useStore } from '../state/store';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 달력에 그릴 6주(또는 5주) 날짜 */
function monthGrid(month: string): string[] {
  const first = parseIsoDate(`${month}-01`);
  const start = shiftDay(`${month}-01`, -first.getDay());
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const end = shiftDay(toIsoDate(last), 6 - last.getDay());
  const days: string[] = [];
  for (let d = start; d <= end; d = shiftDay(d, 1)) days.push(d);
  return days;
}

function shiftMonth(month: string, n: number): string {
  const d = parseIsoDate(`${month}-01`);
  d.setMonth(d.getMonth() + n);
  return toIsoDate(d).slice(0, 7);
}

export function CalendarPage() {
  const { snap, me, toast } = useStore();
  const today = todayIso();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const days = useMemo(() => monthGrid(month), [month]);

  const load = useCallback(async () => {
    try { setEvents(await api.calendar.list(days[0], days[days.length - 1])); } catch (e) { toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error'); setEvents([]); }
  }, [days, toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api.subscribe(() => void load()), [load]);

  if (!snap || !events) return <div className="flex justify-center py-20"><Spinner /></div>;
  const sites = byId(snap.sites);
  const on = (d: string) => events.filter((e) => e.startDate <= d && e.endDate >= d);
  const label = (e: CalendarEvent) => (e.siteId ? `${sites.get(e.siteId)?.name ?? ''} · ${e.title}` : e.title);
  const blank = (date: string): CalendarEvent => ({
    id: newId('ev'), title: '', startDate: date, endDate: date, time: '', siteId: null, scope: me.departmentId ? 'dept' : 'all',
    departmentId: me.departmentId, memo: '', createdBy: me.id, updatedAt: '',
  });
  const go = (m: string) => { setMonth(m); setSelected(m === today.slice(0, 7) ? today : `${m}-01`); };
  const [y, mo] = month.split('-').map(Number);
  const dayList = on(selected);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="캘린더" right={<Button tone="primary" onClick={() => setEditing(blank(selected))}><Plus size={16} />일정 추가</Button>}>
        <span className="text-[13px] text-ink-3">'우리 부서' 일정은 부서원과 열람권한이 있는 부서에, '전체' 일정은 모두에게 보입니다</span>
      </PageHeader>

      <div className="mb-3 flex items-center gap-1">
        <IconButton label="이전 달" onClick={() => go(shiftMonth(month, -1))}><ChevronLeft size={18} /></IconButton>
        <span className="min-w-[110px] text-center text-[17px] font-extrabold tabular">{y}년 {mo}월</span>
        <IconButton label="다음 달" onClick={() => go(shiftMonth(month, 1))}><ChevronRight size={18} /></IconButton>
        {month !== today.slice(0, 7) && <button onClick={() => go(today.slice(0, 7))} className="ml-1 rounded-md bg-brand-soft px-2 py-1 text-[12px] font-bold text-brand-ink">오늘</button>}
        <span className="ml-auto flex items-center gap-3 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />전체</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />부서</span>
        </span>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-sunken text-center text-[12px] font-bold">
          {DOW.map((d, i) => <div key={d} className={cx('py-2', i === 0 ? 'text-danger' : i === 6 ? 'text-brand-ink' : 'text-ink-2')}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = on(d);
            const inMonth = d.startsWith(month);
            const dow = parseIsoDate(d).getDay();
            return (
              <button key={d} type="button" onClick={() => setSelected(d)} onDoubleClick={() => setEditing(blank(d))}
                className={cx('flex min-h-[64px] flex-col border-b border-r border-line p-1 text-left align-top transition-colors last:border-r-0 sm:min-h-[104px] sm:p-1.5 [&:nth-child(7n)]:border-r-0',
                  !inMonth && 'bg-sunken/50', selected === d ? 'bg-brand-soft/60' : 'hover:bg-sunken/70')}>
                <span className={cx('mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12.5px] font-bold tabular',
                  d === today ? 'bg-brand text-on-brand' : !inMonth ? 'text-ink-3/60' : dow === 0 ? 'text-danger' : dow === 6 ? 'text-brand-ink' : 'text-ink')}>
                  {Number(d.slice(8))}
                </span>
                {/* 큰 화면: 제목 막대, 휴대폰: 점 */}
                <span className="hidden w-full space-y-0.5 sm:block">
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className={cx('block truncate rounded px-1 py-px text-[11.5px] font-semibold',
                      e.scope === 'all' ? 'bg-brand/15 text-brand-ink' : 'bg-amber-500/15 text-note-ink')}>
                      {e.time && <span className="mr-0.5 opacity-70">{e.time}</span>}{label(e)}
                    </span>
                  ))}
                  {list.length > 3 && <span className="block px-1 text-[11px] font-semibold text-ink-3">+{list.length - 3}건</span>}
                </span>
                <span className="flex flex-wrap gap-0.5 sm:hidden">
                  {list.slice(0, 4).map((e) => <span key={e.id} className={cx('h-1.5 w-1.5 rounded-full', e.scope === 'all' ? 'bg-brand' : 'bg-amber-500')} />)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <section className="mt-6">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-[16px] font-bold">{dayLabel(selected)} <span className="text-ink-3">{dayList.length}건</span></h2>
          <Button size="sm" onClick={() => setEditing(blank(selected))}><Plus size={14} />이 날 일정 추가</Button>
        </div>
        {dayList.length === 0 ? <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13.5px] text-ink-3">일정이 없습니다</p> : (
          <div className="space-y-2.5">{dayList.map((e) => <EventCard key={e.id} e={e} onEdit={() => setEditing(e)} onChanged={load} />)}</div>
        )}
      </section>

      {editing && <EventForm event={editing} isNew={!events.some((x) => x.id === editing.id)} onClose={() => setEditing(null)} onSaved={(e) => { setEditing(null); setSelected(e.startDate); void load(); }} />}
    </div>
  );
}

function EventCard({ e, onEdit, onChanged }: { e: CalendarEvent; onEdit(): void; onChanged(): void }) {
  const { snap, me, toast } = useStore();
  if (!snap) return null;
  const site = e.siteId ? snap.sites.find((s) => s.id === e.siteId) : undefined;
  const who = snap.members.find((m) => m.id === e.createdBy);
  const dept = snap.departments.find((d) => d.id === e.departmentId);
  const remove = async () => {
    if (!window.confirm(`'${e.title}' 일정을 지울까요?`)) return;
    try { await api.calendar.remove(e.id); toast('일정을 지웠습니다'); onChanged(); } catch (err) { toast(err instanceof Error ? err.message : '지우지 못했습니다.', 'error'); }
  };
  return (
    <Card className={cx('border-l-4 p-4', e.scope === 'all' ? 'border-l-brand' : 'border-l-amber-500')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold">{e.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-1"><Clock size={13} />{e.startDate === e.endDate ? '' : `${dayLabel(e.startDate)} ~ ${dayLabel(e.endDate)} · `}{e.time || '종일'}</span>
            {site && <span className="inline-flex items-center gap-1 font-semibold text-brand-ink"><MapPin size={13} />{site.name}</span>}
            {e.scope === 'all' ? <Badge tone="brand"><Globe2 size={11} />전체</Badge> : <Badge tone="note"><Users size={11} />{dept?.name ?? '부서'}</Badge>}
          </p>
          {e.memo && <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink">{e.memo}</p>}
          <p className="mt-1.5 text-[11.5px] text-ink-3">{who?.isCeo ? '대표님' : who?.name} 등록</p>
        </div>
        {canEditEvent(me, e) && (
          <div className="flex shrink-0 gap-0.5">
            <IconButton label="수정" onClick={onEdit}><Pencil size={15} /></IconButton>
            <IconButton label="삭제" onClick={() => void remove()}><Trash2 size={15} /></IconButton>
          </div>
        )}
      </div>
    </Card>
  );
}

function EventForm({ event, isNew, onClose, onSaved }: { event: CalendarEvent; isNew: boolean; onClose(): void; onSaved(e: CalendarEvent): void }) {
  const { snap, me, toast } = useStore();
  const [e, set] = useState(event);
  const [busy, setBusy] = useState(false);
  if (!snap) return null;
  const up = <K extends keyof CalendarEvent>(k: K, v: CalendarEvent[K]) => set((x) => ({ ...x, [k]: v }));
  const deptId = isNew ? me.departmentId : event.departmentId;
  const deptName = snap.departments.find((d) => d.id === deptId)?.name;
  const save = async () => {
    setBusy(true);
    try { const saved = await api.calendar.save({ ...e, endDate: e.endDate < e.startDate ? e.startDate : e.endDate }); toast(isNew ? '일정을 등록했습니다' : '저장했습니다'); onSaved(saved); }
    catch (err) { toast(err instanceof Error ? err.message : '저장하지 못했습니다.', 'error'); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? '일정 추가' : '일정 수정'} footer={<>
      <Button onClick={onClose}>취소</Button>
      <Button tone="primary" onClick={save} disabled={busy || !e.title.trim()}>{isNew ? '등록' : '저장'}</Button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="제목"><Input id="ev-title" value={e.title} onChange={(x) => up('title', x.target.value)} placeholder="예: 3층 슬래브 타설, 감리단 회의" autoFocus /></Field></div>
        <Field label="날짜"><Input id="ev-start" type="date" value={e.startDate} onChange={(x) => set((v) => ({ ...v, startDate: x.target.value, endDate: v.endDate < x.target.value ? x.target.value : v.endDate }))} /></Field>
        <Field label="끝나는 날" hint="하루 일정이면 그대로 두세요"><Input id="ev-end" type="date" value={e.endDate} min={e.startDate} onChange={(x) => up('endDate', x.target.value)} /></Field>
        <Field label="시간" hint="비워 두면 종일"><Input id="ev-time" type="time" value={e.time} onChange={(x) => up('time', x.target.value)} /></Field>
        <Field label="현장 (선택)">
          <Select id="ev-site" value={e.siteId ?? ''} onChange={(x) => up('siteId', x.target.value || null)}>
            <option value="">현장 없음</option>
            {visibleSites(snap).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="공유 범위">
            {deptId ? (
              <Segmented<CalendarScope> value={e.scope} onChange={(v) => up('scope', v)} options={[
                { id: 'dept', label: `우리 부서 (${deptName ?? ''})` },
                { id: 'all', label: '전체' },
              ]} />
            ) : <p className="text-[13px] text-ink-2">부서가 없는 계정의 일정은 <b>전체</b>에 공유됩니다</p>}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="메모 (선택)">
            <textarea id="ev-memo" value={e.memo} onChange={(x) => up('memo', x.target.value)} rows={3} placeholder="장소, 참석자, 준비물 등"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-[14px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
