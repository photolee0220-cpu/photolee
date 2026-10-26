import type { WeekId } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 이번 보고일: 오늘이 월요일이면 오늘, 아니면 다가오는 월요일 */
export function currentWeekId(now = new Date()): WeekId {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const add = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  return toIsoDate(d);
}

export function shiftWeek(id: WeekId, weeks: number): WeekId {
  const d = parseIsoDate(id);
  d.setDate(d.getDate() + weeks * 7);
  return toIsoDate(d);
}

/** 마감: 보고일 이틀 전 토요일 오전 10시 */
export function deadlineOf(id: WeekId): Date {
  const d = parseIsoDate(id);
  d.setDate(d.getDate() - 2);
  d.setHours(10, 0, 0, 0);
  return d;
}

export function weekLabel(id: WeekId): string {
  const d = parseIsoDate(id);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 보고`;
}

export function weekLabelLong(id: WeekId): string {
  const d = parseIsoDate(id);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (월) 보고`;
}

export function deadlineText(id: WeekId, now = new Date()): { text: string; tone: 'ok' | 'soon' | 'over' } {
  const dl = deadlineOf(id);
  const diff = dl.getTime() - now.getTime();
  const label = `${dl.getMonth() + 1}/${dl.getDate()} (토) 10:00`;
  if (diff <= 0) return { text: `마감 ${label} 지남`, tone: 'over' };
  const h = Math.floor(diff / 3_600_000);
  if (h < 24) return { text: `마감까지 ${h}시간 · ${label}`, tone: 'soon' };
  return { text: `마감까지 ${Math.floor(h / 24)}일 ${h % 24}시간 · ${label}`, tone: 'ok' };
}

export function dday(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const t = parseIsoDate(iso).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - today) / 86_400_000);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = parseIsoDate(iso.slice(0, 10));
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function relativeTime(iso: string, now = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
