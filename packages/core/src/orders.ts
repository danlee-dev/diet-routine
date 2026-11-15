// Shopping reminders: cycle orders by program day, plus weekly Monday/Thursday reminders.
import { CYCLE, URLS } from './data';

export interface DueOrder {
  /** checklist item_key in list 'cycle' */
  id: string;
  name: string;
  url?: string;
  /** open the shop screen instead of a link */
  nav?: 'shop';
  /** days from today (negative = overdue) */
  diff: number;
}

export function dueOrders(opts: { dayIdx: number; dow: number; dayKey: string; done: Set<string> }): DueOrder[] {
  const { dayIdx, dow, dayKey, done } = opts;
  const out: DueOrder[] = [];
  for (const c of CYCLE) {
    for (const dn of c.days) {
      const id = `${c.id}@${dn}`;
      const di = dn - 1;
      if (done.has(id)) continue;
      if (di <= dayIdx + 1 && di >= dayIdx - 5) out.push({ id, name: c.name, url: c.url, diff: di - dayIdx });
    }
  }
  if (dow === 1) out.push({ id: `weekly@${dayKey}`, name: '매주 장보기 (요거트, 샐러드 4개, 토마토, 우유)', nav: 'shop', diff: 0 });
  if (dow === 4) out.push({ id: `salad@${dayKey}`, name: '샐러드 3개 (금~일 분)', url: URLS.salad, diff: 0 });
  return out.filter((x) => !done.has(x.id));
}

export const diffText = (d: number): string => (d === 0 ? '오늘' : d === 1 ? '내일' : d < 0 ? `${-d}일 지남` : `${d}일 뒤`);

/** Program day (1-based) -> next due day number for each cycle item, for the shop screen. */
export function cycleSchedule(dayIdx: number, done: Set<string>) {
  const rows: { id: string; itemId: string; name: string; sub: string; url: string; dayNo: number; diff: number; done: boolean }[] = [];
  for (const c of CYCLE) {
    for (const dn of c.days) {
      const id = `${c.id}@${dn}`;
      rows.push({ id, itemId: c.id, name: c.name, sub: c.sub, url: c.url, dayNo: dn, diff: dn - 1 - dayIdx, done: done.has(id) });
    }
  }
  return rows.sort((a, b) => a.dayNo - b.dayNo);
}
