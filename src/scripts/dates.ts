// Date, time-zone and repeat logic. Everything is in Warsaw wall time; day keys are 'YYYY-MM-DD'.
export const TZ = 'Europe/Warsaw';
type Row = Record<string, any>;
export const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
export const longDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const partsInWarsaw = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
export function wallToIso(value: string) {
  const [day, clock] = value.split('T');
  if (!day || !clock) return null;
  const [year, month, date] = day.split('-').map(Number); const [hour, minute] = clock.split(':').map(Number);
  const desired = Date.UTC(year, month - 1, date, hour, minute);
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const p = partsInWarsaw(new Date(guess));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += desired - represented;
  }
  return new Date(guess).toISOString();
}
export function wallInput(date: Date) { const p = partsInWarsaw(date); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
export function dateOnlyInput(iso?: string | null) { return iso ? dateKey(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : ''; }
export function asDay(iso: string) { return dateKey(new Date(iso)); }
export function todayAtNoon() { const now = new Date(); return new Date(`${dateKey(now)}T12:00:00Z`); }
export function daysFrom(base: Date, amount: number) { const date = new Date(base); date.setUTCDate(date.getUTCDate() + amount); return date; }
// Day-key arithmetic on 'YYYY-MM-DD' strings (noon UTC avoids DST edges).
export function addDaysKey(key: string, days: number) { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000); }
export function addMonthsKey(key: string, months: number) { const [y, m, d] = key.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1 + months, d, 12)); return date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null; }
export const repeatLabels: Record<string, string> = { weekly: 'every week', monthly: 'every month', yearly: 'every year' };
// Expands a repeating event into its occurrences between two day keys, keeping the Warsaw wall-clock time.
// A month without that day (e.g. the 31st) is skipped, like most calendar apps.
export function occurrences(e: Row, from: string, to: string): Array<{ start: string; end: string | null }> {
  const rule = e.recurrence; if (!rule || rule === 'none' || !repeatLabels[rule]) return [{ start: e.starts_at, end: e.ends_at }];
  const firstKey = asDay(e.starts_at); const p = partsInWarsaw(new Date(e.starts_at)); const until = e.repeat_until || '9999-12-31';
  const spanDays = e.ends_at ? daysBetween(firstKey, asDay(e.ends_at)) : 0; const spanMs = e.ends_at ? Date.parse(e.ends_at) - Date.parse(e.starts_at) : null;
  const lookFrom = addDaysKey(from, -Math.max(spanDays, 0) - 1); const out: Array<{ start: string; end: string | null }> = [];
  let i = rule === 'weekly' ? Math.max(0, Math.floor(daysBetween(firstKey, lookFrom) / 7)) : rule === 'monthly' ? Math.max(0, (+lookFrom.slice(0, 4) - +firstKey.slice(0, 4)) * 12 + (+lookFrom.slice(5, 7) - +firstKey.slice(5, 7)) - 1) : Math.max(0, +lookFrom.slice(0, 4) - +firstKey.slice(0, 4) - 1);
  for (let guard = 0; guard < 600; guard++, i++) {
    const key = rule === 'weekly' ? addDaysKey(firstKey, 7 * i) : addMonthsKey(firstKey, rule === 'monthly' ? i : 12 * i);
    if (!key) continue; if (key > to || key > until) break; if (key < lookFrom) continue;
    const start = wallToIso(e.all_day ? `${key}T00:00` : `${key}T${p.hour}:${p.minute}`)!;
    const end = spanMs === null ? null : e.all_day ? wallToIso(`${addDaysKey(key, spanDays)}T00:00`) : new Date(Date.parse(start) + spanMs).toISOString();
    out.push({ start, end });
  }
  return out;
}
// Work shifts: paid hours are the length minus the unpaid break.
export function shiftHours(sh: Row) { return Math.max(0, (Date.parse(sh.ends_at) - Date.parse(sh.starts_at)) / 3600000 - (Number(sh.break_minutes) || 0) / 60); }
// Ends at or before the start mean the shift runs past midnight.
export function shiftTimes(day: string, start: string, end: string) { const startsAt = wallToIso(`${day}T${start}`); const endsAt = wallToIso(`${end <= start ? addDaysKey(day, 1) : day}T${end}`); return { starts_at: startsAt, ends_at: endsAt }; }
