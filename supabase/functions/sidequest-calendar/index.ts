// Read-only iCalendar feed for Google/Apple Calendar subscriptions.
// Deploy with JWT verification OFF: calendar apps cannot send a Supabase token, so the
// secret ?token= link is the credential. It runs with the service role, so it applies
// the same visibility rules as RLS by hand: shared events in full, your own private
// events in full, your partner's private events only as "Busy".
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const TZ = 'Europe/Warsaw';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

type Event = { id: string; space_id: string; title: string; description: string | null; location: string | null; visibility: string; all_day: boolean; starts_at: string; ends_at: string | null; created_by: string; person: string | null; recurrence?: string; repeat_until?: string | null; updated_at?: string | null; created_at?: string | null };

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const icsDate = (key: string) => key.replaceAll('-', '');
const icsInstant = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Warsaw wall-clock time, for repeating events: a UTC start would drift an hour at each DST change.
const icsLocal = (date: Date) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value])); return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`; };
const nextDay = (key: string) => { const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line: string) {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (bytes.encode(current + char).length > (parts.length ? 74 : 75)) { parts.push(current); current = ''; }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n ');
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);
  const token = new URL(request.url).searchParams.get('token') || '';
  if (!/^[0-9a-f]{64}$/.test(token)) return text('Not found', 404);

  const { data: feed } = await supabase.from('calendar_feeds').select('user_id').eq('token_hash', await sha256Hex(token)).maybeSingle();
  if (!feed) return text('Not found', 404);
  const userId = feed.user_id as string;

  const { data: memberships, error: memberError } = await supabase.from('space_members').select('space_id').eq('user_id', userId);
  if (memberError) return text('Could not load calendar', 500);
  const spaceIds = (memberships || []).map((row: { space_id: string }) => row.space_id);
  const { data: members } = spaceIds.length ? await supabase.from('space_members').select('user_id,display_name').in('space_id', spaceIds) : { data: [] };
  const names = new Map((members || []).map((row: { user_id: string; display_name: string | null }) => [row.user_id, row.display_name?.trim() || 'Partner']));

  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  const { data: events, error: eventError } = spaceIds.length
    ? await supabase.from('events').select('*').in('space_id', spaceIds).or(`ends_at.gte.${since},and(ends_at.is.null,starts_at.gte.${since}),recurrence.neq.none`).order('starts_at')
    : { data: [], error: null };
  if (eventError) return text('Could not load calendar', 500);

  const stamp = icsInstant(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sidequest//Shared calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Sidequest', `X-WR-TIMEZONE:${TZ}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const event of (events || []) as Event[]) {
    const hidden = event.visibility === 'personal' && event.created_by !== userId;
    const who = hidden ? event.created_by : event.visibility === 'personal' ? null : event.person;
    const whoName = who && who !== userId ? names.get(who) || 'Partner' : '';
    const title = hidden ? `${whoName || 'Partner'} busy` : whoName ? `${event.title} (${whoName})` : event.title;
    const start = new Date(event.starts_at);
    lines.push('BEGIN:VEVENT', `UID:${event.id}@sidequest`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(title)}`);
    if (event.all_day) {
      const first = dateKey(start);
      const last = event.ends_at ? dateKey(new Date(event.ends_at)) : first;
      lines.push(`DTSTART;VALUE=DATE:${icsDate(first)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(last < first ? first : last))}`);
    } else {
      const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + 3600000);
      if (event.recurrence && event.recurrence !== 'none') lines.push(`DTSTART;TZID=${TZ}:${icsLocal(start)}`, `DTEND;TZID=${TZ}:${icsLocal(end)}`);
      else lines.push(`DTSTART:${icsInstant(start)}`, `DTEND:${icsInstant(end)}`);
    }
    const freq = ({ weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as Record<string, string>)[event.recurrence || ''];
    if (freq) lines.push(`RRULE:FREQ=${freq}${event.repeat_until ? `;UNTIL=${event.all_day ? icsDate(event.repeat_until) : `${icsDate(event.repeat_until)}T235959Z`}` : ''}`);
    if (!hidden && event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (!hidden && event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (hidden || event.visibility === 'personal') lines.push('CLASS:PRIVATE');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="sidequest.ics"' },
  });
});
