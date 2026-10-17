import { describe, expect, it } from 'vitest';
import { addDaysKey, addMonthsKey, asDay, occurrences, shiftHours, shiftTimes, wallInput, wallToIso } from './dates';

describe('Warsaw wall time', () => {
  it('converts summer and winter wall times to UTC', () => {
    expect(wallToIso('2026-07-01T19:00')).toBe('2026-07-01T17:00:00.000Z');
    expect(wallToIso('2026-12-01T19:00')).toBe('2026-12-01T18:00:00.000Z');
  });
  it('round-trips through wallInput', () => {
    expect(wallInput(new Date(wallToIso('2026-10-25T09:30')!))).toBe('2026-10-25T09:30');
  });
  it('reads an all-day (Warsaw midnight) date as that day, not the day before', () => {
    expect(asDay(wallToIso('2026-10-17T00:00')!)).toBe('2026-10-17');
  });
});

describe('day keys', () => {
  it('adds days across month ends', () => expect(addDaysKey('2026-10-31', 1)).toBe('2026-11-01'));
  it('has no 31 February', () => expect(addMonthsKey('2026-01-31', 1)).toBeNull());
});

describe('repeating events', () => {
  const weekly = { starts_at: wallToIso('2026-10-02T19:00')!, ends_at: wallToIso('2026-10-02T21:00')!, recurrence: 'weekly', all_day: false };
  it('keeps 19:00 across the October clock change', () => {
    const [before, after] = occurrences(weekly, '2026-10-23', '2026-10-30');
    expect(wallInput(new Date(before.start))).toBe('2026-10-23T19:00');
    expect(wallInput(new Date(after.start))).toBe('2026-10-30T19:00');
    expect(Date.parse(after.end!) - Date.parse(after.start)).toBe(2 * 3600000);
  });
  it('stops at repeat_until', () => {
    expect(occurrences({ ...weekly, repeat_until: '2026-10-16' }, '2026-10-01', '2026-10-31')).toHaveLength(3);
  });
  it('skips months without the day', () => {
    const monthly = { starts_at: wallToIso('2026-01-31T10:00')!, ends_at: null, recurrence: 'monthly', all_day: false };
    expect(occurrences(monthly, '2026-01-01', '2026-04-30').map(o => asDay(o.start))).toEqual(['2026-01-31', '2026-03-31']);
  });
  it('returns a one-off event as is', () => {
    expect(occurrences({ starts_at: 'x', ends_at: null, recurrence: 'none' }, '2026-01-01', '2026-01-02')).toEqual([{ start: 'x', end: null }]);
  });
});

describe('shifts', () => {
  it('runs past midnight when the end is before the start', () => {
    const t = shiftTimes('2026-10-17', '22:00', '06:00');
    expect(wallInput(new Date(t.ends_at!))).toBe('2026-10-18T06:00');
    expect(shiftHours({ ...t, break_minutes: 30 })).toBe(7.5);
  });
  it('counts the extra hour on the night the clocks go back', () => {
    expect(shiftHours(shiftTimes('2026-10-24', '22:00', '06:00'))).toBe(9);
  });
});
