import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { canEditEntry, canViewDept } from '../lib/access';
import type { SiteHistoryItem } from '../lib/api';
import { api } from '../lib/client';
import {
  byId, has, memberDirective, miscDirective, miscEntry, personEntry, siteDepartments, siteDirective, siteEntry, activeDepartments,
} from '../lib/derive';
import { MISC_SLOTS, type Department, type Entry, type Member } from '../lib/types';
import { formatDate, relativeTime, weekLabel } from '../lib/week';
import { useStore } from '../state/store';
import { DirectiveBox, EntryEditor, Feedback, TextBlock } from './editors';
import { PhotoStrip } from './Photos';
import { dueInfo, isImminent } from './SiteCard';
import { Avatar, Badge, cx, Progress, Sheet, Spinner, StageChip } from './ui';

export function DrawerHost() {
  const { drawer, openDrawer } = useStore();
  const close = () => openDrawer(null);
  if (!drawer) return null;
  if (drawer.type === 'site') return <SiteDrawer id={drawer.id} onClose={close} />;
  if (drawer.type === 'person') return <PersonDrawer id={drawer.id} onClose={close} />;
  return <MiscDrawer onClose={close} />;
}

function Block({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function entryMeta(e: Entry | undefined, members: Map<string, Member>) {
  if (!e || !has(e.content)) return null;
  const who = e.updatedBy ? members.get(e.updatedBy)?.name : '';
  return `${who ? `${who} · ` : ''}${relativeTime(e.updatedAt)} 수정`;
}

function deptPeople(d: Department, members: Member[]) {
  return members.filter((m) => m.active && m.departmentId === d.id).map((m) => m.name).join(', ');
}

function SiteDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { snap, me, weekId, saveEntry, saveDirective } = useStore();
  const [history, setHistory] = useState<SiteHistoryItem[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (showHistory && !history) api.siteHistory(id).then((h) => setHistory(h.filter((x) => x.weekId !== weekId))).catch(() => setHistory([]));
  }, [showHistory, history, id, weekId]);

  const site = snap?.sites.find((s) => s.id === id);
  if (!snap || !site) return null;
  const members = byId(snap.members);
  const depts = siteDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants));
  const directive = siteDirective(snap.directives, site.id);
  const prevDirective = siteDirective(snap.prevDirectives, site.id);
  const due = dueInfo(site);

  return (
    <Sheet
      open
      onClose={onClose}
      title={site.name}
      subtitle={<span className="flex flex-wrap items-center gap-1.5"><StageChip stage={site.stage} />{[site.note, site.process].filter(Boolean).join(' · ')}</span>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <p className="text-[12px] font-semibold text-ink-3">{site.progress != null ? '공정율' : '규모'}</p>
            {site.progress != null ? (
              <div className="mt-1.5 flex items-center gap-2"><Progress value={site.progress} /><span className="shrink-0 whitespace-nowrap text-[15px] font-bold tabular">{site.progress}%</span></div>
            ) : <p className="mt-1 font-semibold">{site.scale || '—'}</p>}
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink-3">{site.stage === 'construction' ? '준공예상일' : '착공예상일'}</p>
            <p className={cx('mt-1 font-semibold tabular', due.tone === 'warn' && 'text-warn', due.tone === 'danger' && 'text-danger', due.tone === 'ok' && 'text-ok')}>
              {site.dueDate ? formatDate(site.dueDate) : site.dueText || '미정'}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink-3">이슈</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {isImminent(site) && <Badge tone="warn">준공임박</Badge>}
              {site.tags.length ? site.tags.map((t) => <Badge key={t}>{t}</Badge>) : !isImminent(site) && <span className="text-ink-3">—</span>}
            </div>
          </div>
        </div>

        <DirectiveBox
          key={`${weekId}-${site.id}`}
          value={directive?.content ?? ''}
          prevContent={prevDirective?.content}
          editable={me.isCeo}
          onSave={(content) => saveDirective({ weekId, targetKind: 'site', siteId: site.id, memberId: null, slot: null, content })}
        />

        {depts.map((d) => {
          const e = siteEntry(snap.entries, site.id, d.id);
          const prev = siteEntry(snap.prevEntries, site.id, d.id);
          const editable = !me.isCeo && canEditEntry(me, { kind: 'site', departmentId: d.id, authorId: null });
          return (
            <Block key={d.id} title={<>{d.name} <span className="font-medium text-ink-3">{deptPeople(d, snap.members)}</span></>}
              right={has(e?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}>
              <EntryEditor
                key={`${weekId}-${site.id}-${d.id}`}
                value={e?.content ?? ''}
                editable={editable}
                prevContent={prev?.content}
                meta={entryMeta(e, members)}
                onSave={(content) => saveEntry({ weekId, kind: 'site', siteId: site.id, departmentId: d.id, authorId: null, content })}
              />
              <PhotoStrip siteId={site.id} departmentId={d.id} editable={editable} />
              <Feedback entry={e} />
            </Block>
          );
        })}
        {depts.length === 0 && <p className="text-[13px] text-ink-3">열람 권한이 있는 부서의 보고가 없습니다.</p>}

        <button onClick={() => setShowHistory((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-left font-semibold shadow-card hover:bg-sunken">
          지난 기록
          <ChevronDown size={18} className={cx('transition-transform', showHistory && 'rotate-180')} />
        </button>
        {showHistory && (
          history == null ? <div className="flex justify-center py-4"><Spinner /></div>
            : history.length === 0 ? <p className="px-1 text-[13px] text-ink-3">이전 주차 기록이 없습니다.</p>
              : (
                <ol className="relative space-y-4 border-l-2 border-line pl-4">
                  {history.map((h) => (
                    <li key={h.weekId}>
                      <p className="text-[13px] font-bold">{weekLabel(h.weekId)}</p>
                      {has(h.directive?.content) && <p className="mt-1 whitespace-pre-wrap rounded-md bg-note px-2.5 py-1.5 text-[13px]"><b className="text-note-ink">지시 </b>{h.directive!.content}</p>}
                      {h.entries.map((e) => (
                        <div key={e.id} className="mt-1.5">
                          <p className="text-[12px] font-semibold text-ink-3">{snap.departments.find((d) => d.id === e.departmentId)?.name}</p>
                          <p className="whitespace-pre-wrap text-[13px] leading-[1.6]">{e.content}</p>
                        </div>
                      ))}
                      {h.photos.length > 0 && <PhotoStrip siteId={site.id} departmentId="" editable={false} photos={h.photos} />}
                    </li>
                  ))}
                </ol>
              )
        )}
      </div>
    </Sheet>
  );
}

function PersonDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const { snap, me, weekId, saveEntry, saveDirective } = useStore();
  const [showPrev, setShowPrev] = useState(false);
  const person = snap?.members.find((m) => m.id === id);
  if (!snap || !person) return null;
  const dept = snap.departments.find((d) => d.id === person.departmentId);
  const members = byId(snap.members);
  const e = personEntry(snap.entries, person.id);
  const prev = personEntry(snap.prevEntries, person.id);
  const directive = memberDirective(snap.directives, person.id);
  const prevDirective = memberDirective(snap.prevDirectives, person.id);
  const editable = !me.isCeo && canEditEntry(me, { kind: 'dept', departmentId: person.departmentId ?? '', authorId: person.id });

  return (
    <Sheet open onClose={onClose}
      title={<span className="flex items-center gap-2.5"><Avatar id={person.id} name={person.name} size={32} />{person.name} {person.title}</span>}
      subtitle={`${dept?.name ?? ''} · ${weekLabel(weekId)}`}>
      <div className="space-y-4">
        <DirectiveBox
          key={`${weekId}-${person.id}`}
          value={directive?.content ?? ''}
          prevContent={prevDirective?.content}
          editable={me.isCeo}
          onSave={(content) => saveDirective({ weekId, targetKind: 'member', siteId: null, memberId: person.id, slot: null, content })}
        />
        <Block title="업무 진행사항" right={has(e?.content) ? <Badge tone="brand">작성</Badge> : <Badge>미작성</Badge>}>
          <EntryEditor
            key={`${weekId}-${person.id}`}
            value={e?.content ?? ''}
            editable={editable}
            prevContent={prev?.content}
            meta={entryMeta(e, members)}
            onSave={(content) => saveEntry({ weekId, kind: 'dept', siteId: null, departmentId: person.departmentId!, authorId: person.id, content })}
          />
          <Feedback entry={e} />
        </Block>
        {has(prev?.content) && (
          <Block title={`지난주 (${weekLabel(snap.prevWeekId!)})`} right={
            <button onClick={() => setShowPrev((v) => !v)} className="text-[13px] font-semibold text-brand-ink">{showPrev ? '접기' : '펼치기'}</button>}>
            {showPrev ? <TextBlock text={prev!.content} className="text-ink-2" /> : <p className="line-clamp-2 whitespace-pre-line text-[13px] text-ink-3">{prev!.content}</p>}
          </Block>
        )}
      </div>
    </Sheet>
  );
}

function MiscDrawer({ onClose }: { onClose(): void }) {
  const { snap, me, weekId, saveEntry, saveDirective } = useStore();
  if (!snap) return null;
  const members = byId(snap.members);
  const slots = MISC_SLOTS.filter((s) => s.everyone || me.isCeo || me.isAdmin);
  const depts = activeDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants)
    && (has(miscEntry(snap.entries, d.id)?.content) || (!me.isCeo && me.departmentId === d.id) || d.writesSites));

  return (
    <Sheet open onClose={onClose} title="기타사항" subtitle={weekLabel(weekId)}>
      <div className="space-y-4">
        {slots.map((s) => (
          <DirectiveBox
            key={`${weekId}-${s.id}`}
            label={s.label}
            value={miscDirective(snap.directives, s.id)?.content ?? ''}
            prevContent={miscDirective(snap.prevDirectives, s.id)?.content}
            editable={me.isCeo}
            onSave={(content) => saveDirective({ weekId, targetKind: 'misc', siteId: null, memberId: null, slot: s.id, content })}
          />
        ))}
        {depts.map((d) => {
          const e = miscEntry(snap.entries, d.id);
          return (
            <Block key={d.id} title={<>{d.name} <span className="font-medium text-ink-3">{deptPeople(d, snap.members)}</span></>}>
              <EntryEditor
                key={`${weekId}-misc-${d.id}`}
                value={e?.content ?? ''}
                editable={!me.isCeo && canEditEntry(me, { kind: 'misc', departmentId: d.id, authorId: null })}
                prevContent={miscEntry(snap.prevEntries, d.id)?.content}
                meta={entryMeta(e, members)}
                placeholder="현장 외 진행 건, 공유할 내용"
                onSave={(content) => saveEntry({ weekId, kind: 'misc', siteId: null, departmentId: d.id, authorId: null, content })}
              />
              <Feedback entry={e} />
            </Block>
          );
        })}
      </div>
    </Sheet>
  );
}
