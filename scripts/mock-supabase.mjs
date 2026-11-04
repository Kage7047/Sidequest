#!/usr/bin/env node
// A stand-in for the Supabase endpoints Sidequest uses, with fictional data, for local UI work,
// screenshots and end-to-end tests. It never talks to the real project.
//
//   node scripts/mock-supabase.mjs            # http://127.0.0.1:54321, demo login below
//   PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 PUBLIC_SUPABASE_PUBLISHABLE_KEY=demo npm run build
//
// Login: sam@example.com / sidequest-demo. Data is in memory and reseeded on every start,
// relative to "now" so Today and Week ahead always have something to show.
// Implements the PostgREST subset the app uses: select, eq/neq/gt/gte/lt/lte/in/is, order,
// limit, insert, upsert (on_conflict), update and delete, single/maybeSingle, and a few RPCs.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 54321);
const EMAIL = 'sam@example.com';
const PASSWORD = 'sidequest-demo';
const SAM = '00000000-0000-4000-8000-000000000001';
const ALEX = '00000000-0000-4000-8000-000000000002';
const SPACE = '00000000-0000-4000-8000-0000000000aa';

const user = {
  id: SAM, aud: 'authenticated', role: 'authenticated', email: EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
};

// ---- seed, relative to today (Warsaw wall clock is close enough to UTC+1 for demo data) -------
const DAY = 86400000;
const at = (days, hour = 12, minute = 0) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour - 1, minute, 0, 0);
  return d.toISOString();
};
const dateOnly = (days) => at(days).slice(0, 10);
const row = (o) => ({ id: randomUUID(), space_id: SPACE, created_at: at(-10), ...o });

function seed() {
  return {
    spaces: [{ id: SPACE, name: 'Sam & Alex', timezone: 'Europe/Warsaw', owner_id: SAM, created_at: at(-60) }],
    space_members: [
      { space_id: SPACE, user_id: SAM, display_name: 'Sam', role: 'owner' },
      { space_id: SPACE, user_id: ALEX, display_name: 'Alex', role: 'member' },
    ],
    events: [
      row({ title: 'Dinner at Marta’s', starts_at: at(0, 19), ends_at: at(0, 21, 30), all_day: false, location: 'Mokotów', visibility: 'shared', created_by: SAM, recurrence: 'none' }),
      row({ title: 'Climbing', starts_at: at(1, 18), ends_at: at(1, 20), all_day: false, location: 'Ściana', visibility: 'shared', created_by: ALEX, recurrence: 'weekly' }),
      row({ title: 'Dentist', starts_at: at(2, 9, 30), ends_at: at(2, 10, 15), all_day: false, location: '', visibility: 'personal', created_by: SAM, recurrence: 'none' }),
      row({ title: 'Weekend in Gdańsk', starts_at: at(4, 0), ends_at: at(5, 23), all_day: true, location: 'Gdańsk', visibility: 'shared', created_by: ALEX, recurrence: 'none' }),
      row({ title: 'Mum’s birthday', starts_at: at(9, 0), ends_at: at(9, 23), all_day: true, location: '', visibility: 'shared', created_by: SAM, recurrence: 'yearly' }),
    ],
    tasks: [
      row({ title: 'Pay the electricity bill', due_at: at(-1, 18), priority: 'high', assigned_to: SAM, completed: false, recurrence_rule: 'monthly', created_by: SAM }),
      row({ title: 'Book train tickets to Gdańsk', due_at: at(0, 20), priority: 'high', assigned_to: ALEX, completed: false, recurrence_rule: 'none', created_by: SAM }),
      row({ title: 'Water the plants', due_at: at(0, 9), priority: 'normal', assigned_to: SAM, completed: true, recurrence_rule: 'weekly', rotate_assignee: true, created_by: ALEX }),
      row({ title: 'Return the library books', due_at: at(2, 17), priority: 'normal', assigned_to: ALEX, completed: false, recurrence_rule: 'none', created_by: ALEX }),
      row({ title: 'Call the landlord about the boiler', due_at: at(3, 12), priority: 'low', assigned_to: null, completed: false, recurrence_rule: 'none', created_by: SAM }),
      row({ title: 'Plan the anniversary', due_at: null, priority: 'normal', assigned_to: SAM, completed: false, recurrence_rule: 'none', created_by: SAM }),
    ],
    projects: [
      row({ title: 'Repaint the bedroom', description: 'Sage green, weekend job', status: 'active', start_date: dateOnly(-5), target_date: dateOnly(12), created_by: SAM }),
      row({ title: 'Learn Polish together', description: 'Two lessons a week', status: 'planned', start_date: dateOnly(7), target_date: null, created_by: ALEX }),
    ],
    goals: [
      row({ title: 'Save for the summer trip', description: '6,000 zł by June', progress: 45, target_date: dateOnly(200), created_by: SAM }),
      row({ title: 'Run a 10k', description: '', progress: 70, target_date: dateOnly(40), created_by: ALEX }),
    ],
    shared_lists: [
      row({ id: 'list-groceries', title: 'Sunday groceries', list_type: 'grocery', created_by: ALEX }),
      row({ id: 'list-packing', title: 'Gdańsk weekend', list_type: 'packing', created_by: SAM }),
    ],
    shared_list_items: [
      ['list-groceries', 'Oat milk', false], ['list-groceries', 'Tomatoes', false], ['list-groceries', 'Pierogi', true],
      ['list-groceries', 'Coffee beans', false], ['list-packing', 'Rain jackets', false], ['list-packing', 'Chargers', true],
    ].map(([list_id, title, completed], i) => ({ id: randomUUID(), list_id, title, completed, position: i, created_by: SAM, created_at: at(-2), completed_at: completed ? at(-1) : null, completed_by: completed ? ALEX : null })),
    shared_ideas: [
      row({ kind: 'date', title: 'Picnic in Łazienki', details: 'Bring the blue blanket', completed: false, created_by: ALEX }),
      row({ kind: 'place', title: 'The little bakery by the river', details: null, completed: false, created_by: SAM }),
      row({ kind: 'activity', title: 'Pottery class', details: null, completed: true, created_by: SAM }),
    ],
    completion_activity: [
      { id: randomUUID(), space_id: SPACE, item_type: 'task', title: 'Water the plants', completed_by: SAM, completed_at: at(0, 9) },
      { id: randomUUID(), space_id: SPACE, item_type: 'task', title: 'Fix the bike light', completed_by: ALEX, completed_at: at(-1, 20) },
    ],
    shifts: [
      row({ person: ALEX, job: 'Bakery', starts_at: at(0, 6), ends_at: at(0, 14), break_minutes: 30, hourly_rate: 32, note: null, created_by: ALEX }),
      row({ person: ALEX, job: 'Bakery', starts_at: at(1, 6), ends_at: at(1, 14), break_minutes: 30, hourly_rate: 32, note: null, created_by: ALEX }),
      row({ person: SAM, job: 'Studio', starts_at: at(2, 10), ends_at: at(2, 18), break_minutes: 45, hourly_rate: 55, note: 'Client shoot', created_by: SAM }),
    ],
    push_subscriptions: [],
  };
}
let db = seed();

// ---- PostgREST subset ----------------------------------------------------------------------
const cmp = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  return v;
}
function matches(r, key, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const v = r[key];
  switch (op) {
    case 'eq': return String(v) === raw || v === coerce(raw);
    case 'neq': return String(v) !== raw;
    case 'gt': return v != null && v > raw;
    case 'gte': return v != null && v >= raw;
    case 'lt': return v != null && v < raw;
    case 'lte': return v != null && v <= raw;
    case 'is': return v === coerce(raw);
    case 'in': return raw.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v));
    default: return true;
  }
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function filterRows(rows, params) {
  let out = rows;
  for (const [k, v] of params) if (!RESERVED.has(k)) out = out.filter((r) => matches(r, k, v));
  return out;
}
function query(rows, params) {
  let out = filterRows(rows, params);
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((o) => {
      const [col, ...mods] = o.split('.');
      return { col, desc: mods.includes('desc'), nullsFirst: mods.includes('nullsfirst') };
    });
    out = [...out].sort((a, b) => {
      for (const { col, desc, nullsFirst } of keys) {
        if (a[col] == null || b[col] == null) {
          if (a[col] == null && b[col] == null) continue;
          return (a[col] == null) === nullsFirst ? -1 : 1;
        }
        const c = cmp(a[col], b[col]) * (desc ? -1 : 1);
        if (c) return c;
      }
      return 0;
    });
  }
  const limit = Number(params.get('limit') || 0);
  if (limit) out = out.slice(0, limit);
  const select = params.get('select');
  if (select && select !== '*') {
    const cols = select.split(',').map((c) => c.trim());
    out = out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  }
  return out;
}

const RPC = {
  partner_busy: () => [],
  rotate_calendar_feed: () => 'demo-feed-token',
  create_space_invitation: () => 'demo-invite-token',
  accept_space_invitation: () => SPACE,
};

// ---- HTTP -------------------------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
};
function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function session() {
  return {
    access_token: 'demo-access-token', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'demo-refresh-token', user,
  };
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const params = url.searchParams;
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (path === '/__reset' && req.method === 'POST') { db = seed(); return send(res, 204); }

    if (path.startsWith('/auth/v1/')) {
      if (path === '/auth/v1/token') {
        const b = await body(req);
        if (params.get('grant_type') === 'refresh_token') return send(res, 200, session());
        if (b?.email === EMAIL && b?.password === PASSWORD) return send(res, 200, session());
        return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, msg: 'Invalid login credentials' });
      }
      if (path === '/auth/v1/user') return send(res, 200, user);
      if (path === '/auth/v1/logout') return send(res, 204);
      if (path === '/auth/v1/signup') return send(res, 400, { code: 400, msg: 'Sign-up needs an invite (demo)' });
      return send(res, 404, { msg: 'not in mock' });
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.slice('/rest/v1/rpc/'.length);
      return fn in RPC ? send(res, 200, RPC[fn](await body(req))) : send(res, 404, { message: `rpc ${fn} not in mock` });
    }

    if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length);
      db[table] ??= [];
      const rows = db[table];
      const single = (req.headers.accept || '').includes('vnd.pgrst.object');
      const prefer = req.headers.prefer || '';
      const wantRows = prefer.includes('return=representation');
      const reply = (out) => {
        if (single) return out.length ? send(res, 200, out[0]) : send(res, 406, { code: 'PGRST116', message: 'no rows' });
        return send(res, 200, out, { 'Content-Range': `0-${Math.max(0, out.length - 1)}/${out.length}` });
      };

      if (req.method === 'GET' || req.method === 'HEAD') return reply(query(rows, params));

      if (req.method === 'POST') {
        const b = await body(req);
        const items = (Array.isArray(b) ? b : [b]).map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }));
        const conflict = params.get('on_conflict');
        const out = [];
        for (const it of items) {
          const existing = conflict ? rows.find((r) => r[conflict] === it[conflict]) : null;
          if (existing && prefer.includes('merge-duplicates')) { Object.assign(existing, it); out.push(existing); }
          else { rows.push(it); out.push(it); }
        }
        return wantRows ? reply(query(out, new URLSearchParams({ select: params.get('select') || '*' }))) : send(res, 201);
      }

      if (req.method === 'PATCH') {
        const b = await body(req);
        const hit = filterRows(rows, params);
        hit.forEach((r) => Object.assign(r, b));
        return wantRows ? reply(query(hit, new URLSearchParams({ select: params.get('select') || '*' }))) : send(res, 204);
      }

      if (req.method === 'DELETE') {
        const hit = new Set(filterRows(rows, params));
        db[table] = rows.filter((r) => !hit.has(r));
        return wantRows ? reply([...hit]) : send(res, 204);
      }
    }
    return send(res, 404, { message: 'not in mock' });
  } catch (e) {
    return send(res, 500, { message: String(e) });
  }
});

// Realtime: refuse the websocket; the app keeps working on polling and its own refreshes.
server.on('upgrade', (_req, socket) => socket.destroy());
server.listen(PORT, '127.0.0.1', () => console.log(`mock supabase on http://127.0.0.1:${PORT} (login ${EMAIL} / ${PASSWORD})`));
