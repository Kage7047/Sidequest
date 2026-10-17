import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TZ, timeFormatter, dateFormatter, longDateFormatter, dateKey, partsInWarsaw, wallToIso, wallInput, dateOnlyInput, asDay, todayAtNoon, daysFrom, addDaysKey, repeatLabels, occurrences, shiftHours, shiftTimes, freeWindows } from './dates';

type Row = Record<string, any>;
type Kind = 'task' | 'event' | 'project' | 'goal';
let pendingInvite = new URLSearchParams(window.location.search).get('invite');
let pendingShortcut = new URLSearchParams(window.location.search).get('action');
const views = ['today', 'calendar', 'tasks', 'lists', 'plans', 'shifts', 'week'];
let pendingView = new URLSearchParams(window.location.search).get('view');
let installPrompt: any = null;
let handledUserId: string | null = null;
let acceptingInvite = false;
let noticeAction: (() => Promise<void> | void) | null = null;
let noticeTimer = 0;
const configured = Boolean(import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const supabase: SupabaseClient | null = configured ? createClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
const state: { user: any; space: Row | null; events: Row[]; busy: Row[]; tasks: Row[]; projects: Row[]; goals: Row[]; members: Row[]; lists: Row[]; ideas: Row[]; listItems: Row[]; activity: Row[]; shifts: Row[]; shiftOffset: number; shiftPerson: string; editingShift?: Row; pushDevices: Row[]; view: string; calendarOffset: number; calendarMode: 'week' | 'month'; calendarPerson: string; showTasks: boolean; selectedDay: string; prefillDay?: string; taskPerson: string; taskFilter: string; planTab: string; focusOnly: boolean; offline: boolean; editing?: Row } = {
  user: null, space: null, events: [], busy: [], tasks: [], projects: [], goals: [], members: [], lists: [], ideas: [], listItems: [], activity: [], shifts: [], shiftOffset: 0, shiftPerson: 'all', pushDevices: [], view: 'today', calendarOffset: 0, calendarMode: 'week', calendarPerson: 'all', showTasks: true, selectedDay: '', taskPerson: 'all', taskFilter: 'open', planTab: 'projects', focusOnly: true, offline: false,
};
let refreshSeq = 0;
let lastRefresh = 0;
let liveChannel: ReturnType<SupabaseClient['channel']> | null = null;
let liveSpaceId = '';
let liveTimer = 0;
// Optional columns added by later migrations; dropped from saves if the database doesn't have them yet.
const missingColumns = new Set<string>();
const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const dialog = (selector: string) => $(selector) as HTMLDialogElement;
function localGet(key:string) { try { return localStorage.getItem(key)||''; } catch { return ''; } }
function localJson<T>(key:string,fallback:T):T { try { const value=localStorage.getItem(key);return value?JSON.parse(value) as T:fallback; } catch { return fallback; } }
function localSet(key:string,value:unknown) { try { localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value)); } catch {} }
const snapshotKey=(userId:string)=>`sidequest:snapshot:${userId}`;
const outboxKey=(userId:string)=>`sidequest:task-outbox:${userId}`;
function updateOfflineStatus() { const banner=$('#offline-status');if(!banner)return;banner.hidden=!state.offline;banner.textContent=state.offline?'Offline — new tasks and list changes are saved on this phone and will sync when you reconnect.':''; }
function cacheSnapshot() { if(!state.user||!state.space)return;localSet(snapshotKey(state.user.id),{space:state.space,events:state.events,busy:state.busy,tasks:state.tasks.filter(task=>!task.offline_pending),projects:state.projects,goals:state.goals,members:state.members,lists:state.lists,ideas:state.ideas,listItems:state.listItems,activity:state.activity,shifts:state.shifts}); }
function restoreSnapshot() { if(!state.user)return false;const saved=localJson<Row|null>(snapshotKey(state.user.id),null);if(!saved?.space)return false;const space=saved.space as Row;state.space=space;state.events=saved.events||[];state.busy=saved.busy||[];state.tasks=[...(saved.tasks||[]),...localJson<Row[]>(outboxKey(state.user.id),[])];state.projects=saved.projects||[];state.goals=saved.goals||[];state.members=saved.members||[];state.lists=saved.lists||[];state.ideas=saved.ideas||[];state.listItems=saved.listItems||[];state.activity=saved.activity||[];state.shifts=saved.shifts||[];state.offline=true;$('#space-name').textContent=space.name||'Our space';render();updateOfflineStatus();return true; }
function isNetworkError(error:unknown) { const message=String((error as any)?.message||error||'');return !navigator.onLine||/failed to fetch|network request failed|fetch failed|load failed/i.test(message); }
function useOfflineSnapshot(error:unknown) { if(!isNetworkError(error)||!restoreSnapshot())return false;return true; }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
function greeting() { const hour = Number(partsInWarsaw(new Date()).hour); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
function notify(message: string, error = false) { const node = $('#notice');noticeAction=null;window.clearTimeout(noticeTimer);node.textContent = message; node.classList.toggle('error', error); node.classList.add('show'); noticeTimer=window.setTimeout(() => node.classList.remove('show'), 3200); }
function notifyActionButton(message:string,label:string,action:()=>Promise<void>|void) { const node=$('#notice');noticeAction=action;window.clearTimeout(noticeTimer);node.replaceChildren(document.createTextNode(message+' '));const button=document.createElement('button');button.type='button';button.className='notice-action';button.dataset.noticeAction='true';button.textContent=label;node.append(button);node.classList.remove('error');node.classList.add('show');noticeTimer=window.setTimeout(()=>{node.classList.remove('show');noticeAction=null;},5000); }
function loading(message: string) { document.querySelectorAll('.view').forEach(view => view.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`); }
function emptyArt(icon:string) { if(icon==='↗'||icon==='◎')return `<svg class="empty-doodle adventure" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 36c6-2 9-8 12-14 3 7 8 11 16 11"/><path d="M26 12l7-3-1 8M9 17l3-3m3 7 2-2"/><circle cx="34" cy="13" r="3"/><path d="M8 39h31"/></svg>`;if(icon==='☷'||icon==='✿')return `<svg class="empty-doodle garden" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 39V23m0 8c-7 0-11-4-12-10 7 0 11 3 12 10Zm0-7c0-7 4-11 10-12 0 7-3 11-10 12Z"/><circle cx="24" cy="15" r="4"/><path d="M24 7v2m0 12v2m-8-8h2m12 0h2m-14-6 2 2m8 8 2 2m0-12-2 2m-8 8-2 2"/><path d="M15 40h18"/></svg>`;return `<svg class="empty-doodle sprig" viewBox="0 0 48 48" aria-hidden="true"><path d="M22 40c1-11 4-19 13-29M22 32c-8 0-12-5-12-11 7 0 11 3 12 11Zm4-9c0-7 4-11 10-12 0 7-4 11-10 12Z"/><circle cx="35" cy="10" r="2"/><path d="M15 41h20"/></svg>`; }
function empty(title: string, message: string, icon = '✳') { return `<div class="empty-state"><div class="empty-mark">${emptyArt(icon)}</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`; }
function itemDate(iso: string | null | undefined) { return iso ? dateFormatter.format(new Date(iso)) : ''; }
function itemTime(iso: string | null | undefined) { return iso ? timeFormatter.format(new Date(iso)) : ''; }
function shortDate(iso: string | null | undefined) { return iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : ''; }
function heading(title: string, subtitle = '') { return `<header class="page-heading"><p class="eyebrow">Your life, on the same page</p><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</header>`; }
function sectionTitle(title: string, count: number, action = '') { return `<div class="section-heading"><h2>${title}</h2><span class="count">${count || ' '}</span>${action}</div>`; }
function dueLabel(iso: string | null | undefined) { if (!iso) return 'No due date'; const day = asDay(iso); const today = dateKey(new Date()); return day < today ? `Overdue · ${itemDate(iso)}` : day === today ? 'Due today' : itemDate(iso); }
function memberLabel(userId:string|null|undefined) { if(!userId)return '';const member=state.members.find(item=>item.user_id===userId);return member?.display_name?.trim()||(userId===state.space?.owner_id?'Ilya':'Angie'); }
function memberOptions(_selected:string|null|undefined):Array<[string,string]> { return [['','Anyone'],...state.members.map((member:Row)=>[member.user_id,memberLabel(member.user_id)] as [string,string])]; }
function profileInitials(name:string) { return name.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()||'').join('')||'S'; }
// Calendar entries: events, the partner's private events as "busy" blocks, and tasks with a due date.
// `who` is the person it belongs to; null means both of you.
type Entry = { kind: 'event' | 'busy' | 'task' | 'shift'; id: string; title: string; start: string; end: string | null; allDay: boolean; who: string | null; private: boolean; location: string; repeat?: string };
const dayLabelFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
function whoClass(who: string | null) { return !who ? 'who-both' : who === state.space?.owner_id ? 'who-owner' : 'who-partner'; }
function whoName(who: string | null) { return who ? memberLabel(who) : 'Both'; }
function calendarEntries(includeTasks: boolean, person = 'all', from = dateKey(new Date()), to = from) {
  const events: Entry[] = state.events.flatMap(e => occurrences(e, from, to).map(o => ({ kind: 'event' as const, id: e.id, title: e.title, start: o.start, end: o.end, allDay: Boolean(e.all_day), who: e.visibility === 'personal' ? e.created_by : (e.person || null), private: e.visibility === 'personal', location: e.location || '', repeat: repeatLabels[e.recurrence] || '' })));
  const busy: Entry[] = state.busy.flatMap(b => occurrences(b, from, to).map(o => ({ kind: 'busy' as const, id: b.id, title: `${memberLabel(b.created_by)} is busy`, start: o.start, end: o.end, allDay: Boolean(b.all_day), who: b.created_by, private: true, location: '' })));
  const tasks: Entry[] = includeTasks ? state.tasks.filter(t => !t.completed && t.due_at && !t.offline_pending).map(t => ({ kind: 'task', id: t.id, title: t.title, start: t.due_at, end: null, allDay: false, who: t.assigned_to || null, private: false, location: '' })) : [];
  const shifts: Entry[] = state.shifts.filter(sh => asDay(sh.ends_at) >= from && asDay(sh.starts_at) <= to).map(sh => ({ kind: 'shift', id: sh.id, title: `Work${sh.job ? ` · ${sh.job}` : ''}`, start: sh.starts_at, end: sh.ends_at, allDay: false, who: sh.person, private: false, location: '' }));
  return [...events, ...busy, ...shifts, ...tasks].filter(entry => person === 'all' || !entry.who || entry.who === person);
}
// Days an entry covers. All-day ends are stored as midnight of the last day; timed ends are exclusive.
function entryDays(entry: Entry) { const first = asDay(entry.start); if (!entry.end) return { first, last: first }; const last = entry.allDay ? asDay(entry.end) : asDay(new Date(Date.parse(entry.end) - 60000).toISOString()); return { first, last: last < first ? first : last }; }
function entriesOn(entries: Entry[], key: string) {
  const startsEarlier = (entry: Entry) => (asDay(entry.start) < key ? 0 : 1);
  return entries.filter(entry => { const { first, last } = entryDays(entry); return first <= key && key <= last; })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || startsEarlier(a) - startsEarlier(b) || a.start.localeCompare(b.start));
}
function entryRow(entry: Entry, key: string) {
  const continued = asDay(entry.start) < key;
  const endsToday = entry.end ? asDay(entry.end) === key : false;
  const time = entry.allDay ? 'All day' : continued ? (endsToday ? `→ ${itemTime(entry.end)}` : 'All day') : itemTime(entry.start);
  const range = !entry.allDay && !continued && entry.end ? `${itemTime(entry.start)}–${itemTime(entry.end)}${endsToday ? '' : ` ${itemDate(entry.end)}`}` : '';
  const multiDay = entry.allDay && entry.end && asDay(entry.end) > asDay(entry.start) ? `${itemDate(entry.start)} – ${itemDate(entry.end)}` : '';
  const meta = [entry.kind === 'task' ? `Task due ${itemTime(entry.start)}` : range, multiDay, entry.location, entry.repeat ? `↻ ${entry.repeat}` : ''].filter(Boolean).join(' · ');
  const tag = entry.kind === 'busy' ? 'Private' : `${whoName(entry.who)}${entry.private ? ' · private' : ''}`;
  const lead = entry.kind === 'task' ? `<button class="check-action" data-toggle-task="${entry.id}" aria-label="Complete ${escapeHtml(entry.title)}"><span class="checkbox"></span></button>` : `<div class="event-time">${time}</div>`;
  const edit = entry.kind === 'busy' ? '' : entry.kind === 'shift' ? `<button class="icon-button" data-edit-shift="${entry.id}" aria-label="Edit shift">···</button>` : `<button class="icon-button" data-edit="${entry.kind}" data-id="${entry.id}" aria-label="Edit ${escapeHtml(entry.title)}">···</button>`;
  return `<div class="row-item cal-entry ${whoClass(entry.who)} ${entry.kind}">${lead}<div class="row-content"><div class="row-title">${escapeHtml(entry.title)}</div>${meta ? `<div class="row-meta">${escapeHtml(meta)}</div>` : ''}</div><span class="tag who-tag">${escapeHtml(tag)}</span>${edit}</div>`;
}
function dayAgenda(key: string, entries: Entry[]) {
  const items = entriesOn(entries, key); const isToday = key === dateKey(new Date());
  const free = state.calendarPerson === 'all' && state.members.length > 1 ? 'You’re both free' : 'Free';
  return `<section class="agenda-day ${isToday ? 'is-today' : ''}"><div class="agenda-day-head"><p class="agenda-day-label">${dayLabelFormatter.format(new Date(`${key}T12:00:00Z`))}${isToday ? ' · Today' : ''}</p><button class="inline-add" data-create-on-day="${key}">+ Event</button></div>${items.length ? `<div class="list">${items.map(entry => entryRow(entry, key)).join('')}</div>` : `<p class="agenda-free">${free}</p>`}</section>`;
}
// The next few days' events for the Today page.
function comingUp() {
  const today = dateKey(new Date()); const to = addDaysKey(today, 7); const entries = calendarEntries(false, 'all', addDaysKey(today, 1), to);
  const seen = new Set<string>(); const rows: string[] = [];
  for (let d = 1; d <= 7 && rows.length < 6; d++) { const key = addDaysKey(today, d); for (const entry of entriesOn(entries, key)) { const id = `${entry.id}:${asDay(entry.start)}`; if (seen.has(id) || rows.length >= 6) continue; seen.add(id); rows.push(`<div class="coming-day">${escapeHtml(d === 1 ? 'Tomorrow' : itemDate(`${key}T12:00:00Z`))}</div>${entryRow(entry, key)}`); } }
  return `<section>${sectionTitle('Coming up', rows.length, '<button class="inline-add" data-view="calendar">Calendar →</button>')}<div class="surface">${rows.length ? `<div class="list">${rows.join('')}</div>` : empty('A quiet week ahead', 'Nothing planned for the next seven days yet.', '☼')}</div></section>`;
}
function taskRow(task: Row) { const overdue=!task.completed&&task.due_at&&asDay(task.due_at)<dateKey(new Date());const details=[task.due_at?dueLabel(task.due_at):'',task.assigned_to?memberLabel(task.assigned_to):'',task.recurrence_rule&&task.recurrence_rule!=='none'?`↻ ${task.recurrence_rule}${task.rotate_assignee?' · taking turns':''}`:'',task.reminder_at?'Reminder set':''].filter(Boolean).join(' · ');return `<div class="row-item"><button class="check-action" data-toggle-task="${task.id}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${escapeHtml(task.title)}"><span class="checkbox ${task.completed ? 'done' : ''}">${task.completed ? '✓' : ''}</span></button><div class="row-content"><div class="row-title" ${task.completed ? 'style="text-decoration:line-through;color:#929387"' : ''}>${escapeHtml(task.title)}${task.offline_pending?' <span class="tag">Waiting to sync</span>':''}</div><div class="row-meta"><span class="priority-dot ${task.priority === 'high' ? 'high' : task.priority === 'low' ? 'low' : ''}"></span>${escapeHtml(task.priority)} priority${details?` · ${escapeHtml(details)}`:''}</div>${overdue||task.reminder_at&&!task.completed?`<div class="quick-task-actions">${overdue?`<span class="overdue-label">Overdue</span><button class="text-button" data-overdue-task="${task.id}" data-overdue-action="today">Today</button><button class="text-button" data-overdue-task="${task.id}" data-overdue-action="tomorrow">Tomorrow</button><button class="text-button" data-overdue-task="${task.id}" data-overdue-action="clear">No date</button>`:''}${task.reminder_at&&!task.completed?`<button class="text-button" data-snooze-task="${task.id}" data-snooze="hour">Snooze 1 hour</button><button class="text-button" data-snooze-task="${task.id}" data-snooze="tomorrow">Tomorrow</button>`:''}</div>`:''}</div><button class="icon-button" data-edit="task" data-id="${task.id}" aria-label="Edit ${escapeHtml(task.title)}">···</button></div>`; }
function quickAssigneeChoices(value:string) { const recent=localGet(`sidequest:last-assignee:${state.user?.id}`)||'';const selected=value||(state.members.some((member:Row)=>member.user_id===recent)?recent:'');return `<div class="quick-assignee"><span>For</span>${[['','Anyone'],...state.members.map((member:Row)=>[member.user_id,memberLabel(member.user_id)] as [string,string])].map(([id,name])=>`<button type="button" class="assignee-chip ${selected===id?'selected':''}" data-quick-assignee="${escapeHtml(id)}" aria-pressed="${selected===id}">${escapeHtml(name)}</button>`).join('')}</div>`; }
function completionActivity() { return state.activity.length?`<section>${sectionTitle('Little wins',state.activity.length)}<div class="surface soft win-list">${state.activity.slice(0,5).map((item:Row)=>`<div class="win-item"><span aria-hidden="true">✦</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.completed_by?memberLabel(item.completed_by):'You both')} · ${item.item_type==='goal'?'goal reached':'task done'} · ${itemDate(item.completed_at)}</small></div></div>`).join('')}</div></section>`:empty('Your wins will gather here','Finishing a task or reaching a goal adds a little celebration.','✿'); }
function projectCard(project: Row) { return `<article class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(project.title)}</span><span class="tag ${project.status === 'done' ? 'done' : ''}">${escapeHtml(project.status)}</span></div>${project.description ? `<div class="row-meta">${escapeHtml(project.description)}</div>` : ''}<div class="plan-meta">${project.start_date ? shortDate(project.start_date) : 'No start date'}${project.target_date ? ` → ${shortDate(project.target_date)}` : ''}</div><div class="tile-actions" style="margin-top:8px"><button class="text-button" data-edit="project" data-id="${project.id}">Edit project</button></div></article>`; }
function goalCard(goal: Row) { return `<article class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(goal.title)}</span><span class="plan-meta">${goal.progress===100?'Reached ✨':`${goal.progress}%`}</span></div>${goal.description ? `<div class="row-meta">${escapeHtml(goal.description)}</div>` : ''}<div class="progress-track"><span style="width:${Math.max(0, Math.min(100, Number(goal.progress)))}%"></span></div><div class="tile-footer"><span>${goal.target_date ? `Target · ${shortDate(goal.target_date)}` : 'No target date'}</span><div>${goal.progress<100?`<button class="text-button" data-complete-goal="${goal.id}">We did it</button>`:''}<button class="text-button" data-edit="goal" data-id="${goal.id}">Edit</button></div></div></article>`; }
// The next times you're both free (see freeWindows), from events, partner busy blocks and shifts.
function freeTogether(days = 14) {
  const from = dateKey(new Date()); const to = addDaysKey(from, days);
  const busy = calendarEntries(false, 'all', from, to).map(e => e.allDay ? { start: Date.parse(wallToIso(`${asDay(e.start)}T00:00`)!), end: Date.parse(wallToIso(`${addDaysKey(e.end ? asDay(e.end) : asDay(e.start), 1)}T00:00`)!) } : { start: Date.parse(e.start), end: e.end ? Date.parse(e.end) : Date.parse(e.start) + 3600000 });
  // Round "now" up to the next half hour so suggestions start at a sensible time.
  return freeWindows(busy, from, days, Math.ceil(Date.now() / 1800000) * 1800000);
}
function freeTogetherCard(limit: number, days = 14) {
  if (state.members.length < 2) return '';
  const slots = freeTogether(days).slice(0, limit);
  const rows = slots.map(slot => { const start = new Date(slot.start); const hours = Math.round((slot.end - slot.start) / 1800000) / 2; return `<div class="row-item free-slot"><div class="row-content"><div class="row-title">${escapeHtml(itemDate(start.toISOString()))} · ${itemTime(start.toISOString())}–${itemTime(new Date(slot.end).toISOString())}</div><div class="row-meta">${hours} h free together</div></div><button class="button secondary small" data-plan-slot="${wallInput(start)}">Plan</button></div>`; }).join('');
  return `<section>${sectionTitle('Free together', slots.length)}<div class="surface">${rows ? `<div class="list">${rows}</div>` : empty('No shared free time soon', 'Nothing of two hours or more in the next two weeks.', '☼')}</div></section>`;
}
function renderToday() {
  const todayKey = dateKey(new Date()); const now = Date.now(); const todayEvents = entriesOn(calendarEntries(false), todayKey).filter(e => e.allDay || (e.end ? Date.parse(e.end) : Date.parse(e.start) + 3600000) > now);
  const tasks = state.tasks.filter(t => !t.completed && (!state.focusOnly || Boolean(t.due_at && asDay(t.due_at) <= todayKey))).sort((a,b) => (a.due_at || '').localeCompare(b.due_at || ''));
  const upcomingProjects = state.projects.filter(p => p.status === 'active').slice(0,3); const openGoals = state.goals.filter(g => g.progress < 100).slice(0,3);
  $('#view-today').innerHTML = `${heading(`${greeting()}, ${escapeHtml(memberLabel(state.user?.id)||'you')}.`, longDateFormatter.format(new Date()))}<div class="toolbar focus-toolbar"><button class="filter-chip week-link" data-view="week">${new Date().getDay()===0?'✦ Plan the week ahead':'Week ahead →'}</button><span class="muted">${state.focusOnly?'Due today and overdue':'All open tasks'}</span><button class="filter-chip ${state.focusOnly?'selected':''}" data-toggle-focus>${state.focusOnly?'Show all open tasks':'Focus on today'}</button></div><div class="today-grid"><div class="stack"><section>${sectionTitle('Today’s events', todayEvents.length, '<button class="inline-add" data-create="event">+ Add event</button>')}<div class="surface">${todayEvents.length ? `<div class="list">${todayEvents.map(e=>entryRow(e,todayKey)).join('')}</div>` : empty('Nothing on the calendar yet', 'A little room to breathe. Add something you’re looking forward to.', '☼')}</div></section><section>${sectionTitle(state.focusOnly?'Due and overdue':'Open tasks', tasks.length, '<button class="inline-add" data-create="task">+ Add task</button>')}<div class="surface">${tasks.length ? `<div class="list">${tasks.map(taskRow).join('')}</div>` : empty(state.focusOnly?'Nothing due right now':'You’re all caught up', state.focusOnly?'Switch to all open tasks to see the rest of your list.':'Add a task when something comes to mind.', '✓')}</div></section>${comingUp()}</div><div class="stack">${freeTogetherCard(3)}<section>${sectionTitle('In motion', upcomingProjects.length)}<div class="surface soft">${upcomingProjects.length ? upcomingProjects.map(p => `<div class="plan-card"><div class="plan-title">${escapeHtml(p.title)}</div><div class="plan-meta">${p.target_date ? `Until ${shortDate(p.target_date)}` : 'Project'}</div></div>`).join('') : empty('Projects will live here', 'Start a shared project when you’re ready.', '↗')}</div></section><section>${sectionTitle('Growing toward', openGoals.length)}<div class="surface">${openGoals.length ? openGoals.map(g => `<div class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(g.title)}</span><span class="plan-meta">${g.progress}%</span></div><div class="progress-track"><span style="width:${g.progress}%"></span></div></div>`).join('') : empty('Your goals, at your pace', 'A small step counts too.', '◎')}</div></section>${completionActivity()}<section class="surface soft"><div class="section-heading"><h2>A small reminder</h2><span class="sidebar-sparkle">✳</span></div><p class="muted" style="margin:0">You don’t have to figure everything out today. Just keep choosing the next kind thing.</p></section></div></div>`;
}
function renderCalendar() {
  const month = state.calendarMode === 'month'; let entries: Entry[] = []; const todayKey = dateKey(new Date());
  const people: Array<[string, string]> = [['all', 'Everyone'], ...state.members.map((m: Row) => [m.user_id, memberLabel(m.user_id)] as [string, string])];
  const filters = `<div class="filters person-filter">${people.map(([id, name]) => `<button class="filter-chip ${state.calendarPerson === id ? 'selected' : ''}" data-calendar-person="${escapeHtml(id)}" aria-pressed="${state.calendarPerson === id}"><span class="who-dot ${id === 'all' ? 'who-both' : whoClass(id)}"></span>${escapeHtml(name)}</button>`).join('')}<button class="filter-chip ${state.showTasks ? 'selected' : ''}" data-toggle-cal-tasks aria-pressed="${state.showTasks}">✓ Tasks</button></div>`;
  let label: string; let body: string;
  if (month) {
    const p = partsInWarsaw(new Date()); const first = new Date(Date.UTC(+p.year, +p.month - 1 + state.calendarOffset, 1, 12));
    const lead = (first.getUTCDay() + 6) % 7; const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
    const cells = Array.from({ length: Math.ceil((lead + daysInMonth) / 7) * 7 }, (_, i) => daysFrom(first, i - lead));
    entries = calendarEntries(state.showTasks, state.calendarPerson, dateKey(cells[0]), dateKey(cells[cells.length - 1]));
    const inMonth = (key: string) => key.slice(0, 7) === dateKey(first).slice(0, 7);
    const selected = state.selectedDay && inMonth(state.selectedDay) ? state.selectedDay : inMonth(todayKey) ? todayKey : dateKey(first);
    label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    body = `<div class="surface month-surface"><div class="month-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span class="month-weekday">${d}</span>`).join('')}${cells.map(date => {
      const key = dateKey(date); const items = entriesOn(entries, key);
      return `<button class="month-cell ${inMonth(key) ? '' : 'outside'} ${key === todayKey ? 'today' : ''} ${key === selected ? 'selected' : ''}" data-calendar-select="${key}" aria-label="${dayLabelFormatter.format(date)}, ${items.length} ${items.length === 1 ? 'item' : 'items'}"><span class="month-day">${date.getUTCDate()}</span><span class="month-items">${items.slice(0, 3).map(e => `<span class="month-chip ${whoClass(e.who)} ${e.kind}">${escapeHtml(e.kind === 'busy' ? 'Busy' : e.title)}</span>`).join('')}${items.length > 3 ? `<span class="month-more">+${items.length - 3}</span>` : ''}</span></button>`;
    }).join('')}</div></div><div class="surface">${dayAgenda(selected, entries)}</div>`;
  } else {
    const day = daysFrom(todayAtNoon(), state.calendarOffset * 7); const start = daysFrom(day, -((day.getUTCDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => daysFrom(start, i));
    entries = calendarEntries(state.showTasks, state.calendarPerson, dateKey(days[0]), dateKey(days[6]));
    label = `${new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(start)} – ${new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(days[6])}`;
    body = `<div class="surface">${days.map(date => dayAgenda(dateKey(date), entries)).join('')}</div>`;
  }
  const unit = month ? 'month' : 'week'; body = `${body}<div class="free-calendar">${freeTogetherCard(6)}</div>`;
  $('#view-calendar').innerHTML = `${heading('Calendar', 'Who’s doing what, and when you’re both free.')}<div class="toolbar calendar-toolbar"><div class="segmented"><button class="${month ? '' : 'selected'}" data-calendar-mode="week">Week</button><button class="${month ? 'selected' : ''}" data-calendar-mode="month">Month</button></div><div class="date-nav"><button data-calendar-step="-1" aria-label="Previous ${unit}">‹</button><span class="date-label">${label}</span><button data-calendar-step="1" aria-label="Next ${unit}">›</button></div><button class="button secondary small" data-calendar-day="today">Today</button><button class="button primary small" data-create="event">+ New event</button></div>${filters}${body}`;
}
// Open tasks grouped by when they're due.
function taskGroups(list:Row[]) {
  const today=dateKey(new Date());const tomorrow=addDaysKey(today,1);const week=addDaysKey(today,7);
  const groups:Array<[string,Row[]]>=[['Overdue',[]],['Today',[]],['Tomorrow',[]],['This week',[]],['Later',[]],['No date',[]]];
  for(const task of list){const day=task.due_at?asDay(task.due_at):'';groups[!day?5:day<today?0:day===today?1:day===tomorrow?2:day<=week?3:4][1].push(task);}
  return groups.filter(([,rows])=>rows.length);
}
function renderTasks() {
  const filters=[['open','To do'],['completed','Done'],['all','Everything']];
  const people:Array<[string,string]>=[['all','Everyone'],...state.members.map((m:Row)=>[m.user_id,m.user_id===state.user?.id?'Mine':memberLabel(m.user_id)] as [string,string])];
  const forPerson=(task:Row)=>state.taskPerson==='all'||!task.assigned_to||task.assigned_to===state.taskPerson;
  const list=state.tasks.filter(t=>(state.taskFilter==='all'||(state.taskFilter==='completed'?t.completed:!t.completed))&&forPerson(t)).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.due_at||'').localeCompare(b.due_at||''));
  const body=!list.length?empty(state.taskFilter==='completed'?'Nothing completed just yet':'Your list is clear','Add a task and take it one step at a time.','✓'):state.taskFilter==='open'?taskGroups(list).map(([label,rows])=>`<section class="task-group"><h3 class="task-group-title ${label==='Overdue'?'overdue':''}">${label} <span class="count">${rows.length}</span></h3><div class="list">${rows.map(taskRow).join('')}</div></section>`).join(''):`<div class="list">${list.map(taskRow).join('')}</div>`;
  $('#view-tasks').innerHTML=`${heading('Tasks', 'The little things that make the bigger things happen.')}<div class="toolbar task-toolbar"><div class="filters">${filters.map(([value,label])=>`<button class="filter-chip ${state.taskFilter===value?'selected':''}" data-task-filter="${value}">${label}${value==='open'?` · ${state.tasks.filter(t=>!t.completed&&forPerson(t)).length}`:''}</button>`).join('')}</div><div class="task-toolbar-actions"><button class="button secondary small" data-enable-reminders>Enable reminders</button><button class="button secondary small" data-manage-devices>Devices</button><button class="button primary small" data-create="task">+ Add task</button></div></div>${state.members.length>1?`<div class="filters person-filter">${people.map(([id,name])=>`<button class="filter-chip ${state.taskPerson===id?'selected':''}" data-task-person="${escapeHtml(id)}" aria-pressed="${state.taskPerson===id}">${id==='all'?'':`<span class="who-dot ${whoClass(id)}"></span>`}${escapeHtml(name)}</button>`).join('')}</div>`:''}<p class="tiny muted reminder-note">Reminders can reach you after Sidequest is closed. Install the app first on iPhone.</p><div class="surface">${body}</div>`;
}
function renderLists() {
  const kindLabels:Record<string,string>={grocery:'Groceries',packing:'Packing',custom:'Shared list'};
  $('#view-lists').innerHTML=`${heading('Shared lists','A little list for the things you pick up, pack, and remember together.')}<div class="toolbar"><span class="muted">${state.lists.length} ${state.lists.length===1?'list':'lists'}</span><button class="button primary small" data-open-list-dialog>+ New list</button></div>${state.lists.length?`<div class="shared-list-grid">${state.lists.map((list:Row)=>{
    // Unticked first; ticked items sink to the bottom.
    const items=state.listItems.filter((item:Row)=>item.list_id===list.id).sort((a:Row,b:Row)=>Number(a.completed)-Number(b.completed));const open=items.filter((item:Row)=>!item.completed);const ticked=items.length-open.length;const recent=localJson<string[]>(`sidequest:recent-list:${state.user?.id}:${list.id}`,[]).filter(title=>!open.some((item:Row)=>item.title.toLowerCase()===title.toLowerCase()));
    return `<article class="surface shared-list-card"><div class="shared-list-head"><div><span class="eyebrow">${escapeHtml(kindLabels[list.list_type]||kindLabels.custom)}</span><h2>${escapeHtml(list.title)}</h2></div><span class="count">${open.length} left</span></div><form class="list-item-form" data-list-item-form="${list.id}"><input name="title" maxlength="200" aria-label="Add to ${escapeHtml(list.title)}" placeholder="Add an item…" required /><button class="button secondary small" aria-label="Add item">＋</button></form>${recent.length?`<div class="recent-list-items"><span>Add again</span>${recent.map(item=>`<button type="button" class="filter-chip" data-recent-list-item="${list.id}" data-title="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')}</div>`:''}<div class="list">${items.length?items.map((item:Row)=>`<div class="list-item ${item.completed?'completed':''}"><button class="check-action" data-toggle-list-item="${item.id}" aria-label="${item.completed?'Uncheck':'Check'} ${escapeHtml(item.title)}"><span class="checkbox ${item.completed?'done':''}">${item.completed?'✓':''}</span></button><span>${escapeHtml(item.title)}</span><button class="icon-button" data-delete-list-item="${item.id}" aria-label="Remove ${escapeHtml(item.title)}">×</button></div>`).join(''):`<p class="list-empty">Your first item can be anything.</p>`}</div><div class="list-footer">${ticked?`<button class="text-button" data-clear-ticked="${list.id}">Clear ${ticked} ticked</button>`:'<span></span>'}<button class="text-button muted-action" data-delete-list="${list.id}">Delete list</button></div></article>`;}).join('')}</div>`:empty('A list for the little things','Start with groceries, a packing list, or whatever you both need to remember.','☷')}`;
}
function renderPlans() {
  const isProjects=state.planTab==='projects';const isGoals=state.planTab==='goals';const records=isProjects?state.projects:state.goals;
  const tabs=`<div class="plan-tabs"><button class="${isProjects?'selected':''}" data-plan-tab="projects">Projects <span class="count">${state.projects.length}</span></button><button class="${isGoals?'selected':''}" data-plan-tab="goals">Goals <span class="count">${state.goals.length}</span></button><button class="${!isProjects&&!isGoals?'selected':''}" data-plan-tab="ideas">Someday <span class="count">${state.ideas.filter((idea:Row)=>!idea.completed).length}</span></button></div>`;
  if(!isProjects&&!isGoals){const ideas=state.ideas.filter((idea:Row)=>!idea.completed);const done=state.ideas.filter((idea:Row)=>idea.completed);$('#view-plans').innerHTML=`${heading('Our plans','The things you’re building and the places you hope to go.')}<div class="toolbar">${tabs}<button class="button primary small" data-open-idea-dialog>+ Save an idea</button></div><div class="idea-grid">${ideas.length?ideas.map((idea:Row)=>`<article class="surface idea-card"><span class="idea-doodle" aria-hidden="true">${idea.kind==='date'?'✿':idea.kind==='place'?'⌖':'✦'}</span><div class="idea-kind">${idea.kind==='date'?'Date idea':idea.kind==='place'?'Place to visit':'Something to try'}</div><h2>${escapeHtml(idea.title)}</h2>${idea.details?`<p>${escapeHtml(idea.details)}</p>`:''}<div class="idea-actions"><button class="text-button" data-toggle-idea="${idea.id}">We did this ✓</button><button class="icon-button" data-delete-idea="${idea.id}" aria-label="Remove idea">×</button></div></article>`).join(''):empty('Keep a little room for someday','Save a date idea, a place, or something you’d like to try together.','✿')}${done.length?`<section class="done-ideas"><h2>Lovely memories</h2>${done.map((idea:Row)=>`<button class="done-idea" data-toggle-idea="${idea.id}">✓ ${escapeHtml(idea.title)}</button>`).join('')}</section>`:''}</div>`;return;}
  $('#view-plans').innerHTML=`${heading('Our plans', 'The things you’re building and the places you hope to go.')}<div class="toolbar">${tabs}<button class="button primary small" data-create="${isProjects?'project':'goal'}">+ Add ${isProjects?'project':'goal'}</button></div><div class="plan-grid">${records.length?records.map(isProjects?projectCard:goalCard).join(''):empty(isProjects?'A project starts with an idea':'Give a hope somewhere to grow',isProjects?'Plan something you’d like to do together.':'Choose a goal you can work toward together.',isProjects?'↗':'◎')}</div>`;
}
// Work shifts and pay. Hours are paid time (length minus the unpaid break); pay is hours × the shift's rate.
const money = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
function shiftPay(sh: Row) { return sh.hourly_rate === null || sh.hourly_rate === undefined ? null : shiftHours(sh) * Number(sh.hourly_rate); }
function hoursLabel(hours: number) { const h = Math.floor(hours + 1e-9); const m = Math.round((hours - h) * 60); return m ? `${h} h ${m} min` : `${h} h`; }
function shiftWeekStart(offset = state.shiftOffset) { const day = daysFrom(todayAtNoon(), offset * 7); return dateKey(daysFrom(day, -((day.getUTCDay() + 6) % 7))); }
function shiftTotals(rows: Row[]) { const hours = rows.reduce((sum, sh) => sum + shiftHours(sh), 0); const paid = rows.map(shiftPay).filter((v): v is number => v !== null); return { hours, pay: paid.reduce((a, b) => a + b, 0), unrated: rows.length - paid.length, count: rows.length }; }
function totalsCard(label: string, rows: Row[]) {
  const people = state.members.map((m: Row) => m.user_id);
  return `<div class="surface shift-totals"><p class="eyebrow">${label}</p>${people.map(id => { const t = shiftTotals(rows.filter(sh => sh.person === id)); return `<div class="shift-total-row ${whoClass(id)}"><span class="who-dot ${whoClass(id)}"></span><strong>${escapeHtml(memberLabel(id))}</strong><span>${t.count ? `${hoursLabel(t.hours)} · ${t.count} ${t.count === 1 ? 'shift' : 'shifts'}` : 'No shifts'}</span><b>${t.count ? money.format(t.pay) : '—'}</b>${t.unrated ? `<small>${t.unrated} without a rate</small>` : ''}</div>`; }).join('')}</div>`;
}
function renderShifts() {
  const node = $('#view-shifts'); if (!node) return;
  const start = shiftWeekStart(); const end = addDaysKey(start, 6); const todayKey = dateKey(new Date());
  const inRange = (sh: Row, a: string, b: string) => { const day = asDay(sh.starts_at); return day >= a && day <= b; };
  const visible = (sh: Row) => state.shiftPerson === 'all' || sh.person === state.shiftPerson;
  const week = state.shifts.filter(sh => inRange(sh, start, end));
  const month = start.slice(0, 7); const monthRows = state.shifts.filter(sh => asDay(sh.starts_at).slice(0, 7) === month);
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${start}T12:00:00Z`));
  const people: Array<[string, string]> = [['all', 'Both'], ...state.members.map((m: Row) => [m.user_id, memberLabel(m.user_id)] as [string, string])];
  const filters = `<div class="filters person-filter">${people.map(([id, name]) => `<button class="filter-chip ${state.shiftPerson === id ? 'selected' : ''}" data-shift-person="${escapeHtml(id)}" aria-pressed="${state.shiftPerson === id}"><span class="who-dot ${id === 'all' ? 'who-both' : whoClass(id)}"></span>${escapeHtml(name)}</button>`).join('')}</div>`;
  const label = `${shortDate(start)} – ${shortDate(end)}`;
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i)).map(key => {
    const rows = week.filter(sh => asDay(sh.starts_at) === key && visible(sh));
    return `<section class="agenda-day ${key === todayKey ? 'is-today' : ''}"><div class="agenda-day-head"><p class="agenda-day-label">${dayLabelFormatter.format(new Date(`${key}T12:00:00Z`))}${key === todayKey ? ' · Today' : ''}</p><button class="inline-add" data-add-shift="${key}">+ Shift</button></div>${rows.length ? `<div class="list">${rows.map(sh => { const pay = shiftPay(sh); const meta = [hoursLabel(shiftHours(sh)), sh.break_minutes ? `${sh.break_minutes} min break` : '', pay !== null ? `${money.format(pay)} (${money.format(Number(sh.hourly_rate))}/h)` : '', sh.note || ''].filter(Boolean).join(' · '); return `<div class="row-item cal-entry shift ${whoClass(sh.person)}"><div class="event-time">${itemTime(sh.starts_at)}–${itemTime(sh.ends_at)}</div><div class="row-content"><div class="row-title">${escapeHtml(sh.job || 'Work')}</div><div class="row-meta">${escapeHtml(meta)}</div></div><span class="tag who-tag">${escapeHtml(memberLabel(sh.person))}</span><button class="icon-button" data-edit-shift="${sh.id}" aria-label="Edit shift">···</button></div>`; }).join('')}</div>` : `<p class="agenda-free">No shifts</p>`}</section>`;
  }).join('');
  const prevWeek = state.shifts.filter(sh => inRange(sh, addDaysKey(start, -7), addDaysKey(start, -1)) && visible(sh));
  const copy = !week.filter(visible).length && prevWeek.length ? `<button class="button secondary small" data-copy-shifts>Copy last week (${prevWeek.length})</button>` : '';
  const mine = shiftTotals(week.filter(sh => sh.person === state.user?.id));
  const lastRate = state.shifts.filter(sh => sh.person === state.user?.id && sh.hourly_rate !== null).slice(-1)[0]?.hourly_rate ?? '';
  node.innerHTML = `${heading('Shifts', 'Who’s working when, and what it adds up to.')}<div class="toolbar calendar-toolbar">${filters}<div class="date-nav"><button data-shift-step="-1" aria-label="Previous week">‹</button><span class="date-label">${label}</span><button data-shift-step="1" aria-label="Next week">›</button></div></div><div class="today-grid"><div class="stack"><div class="surface">${days}</div><div class="toolbar"><button class="button primary small" data-add-shift="${state.shiftOffset ? start : todayKey}">+ Add shift</button>${copy}${state.shiftOffset ? '<button class="text-button" data-shift-step="0">Back to this week</button>' : ''}</div></div><div class="stack">${totalsCard('This week', week)}${totalsCard(monthName, monthRows)}<form class="surface pay-calc" data-pay-calc><div class="section-heading"><h2>Pay calculator</h2></div><label>Hours<input name="hours" type="number" min="0" step="0.25" inputmode="decimal" value="${mine.hours ? +mine.hours.toFixed(2) : ''}" placeholder="e.g. 32" /></label><label>Hourly rate (zł)<input name="rate" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(lastRate)}" placeholder="e.g. 31.40" /></label><label>Overtime hours (× 1.5)<input name="overtime" type="number" min="0" step="0.25" inputmode="decimal" placeholder="0" /></label><p class="pay-result" data-pay-result></p><p class="muted tiny">Gross, before tax. Hours start from your shifts this week.</p></form></div></div>`;
  updatePayCalc();
}
function updatePayCalc() {
  const form = document.querySelector<HTMLFormElement>('[data-pay-calc]'); if (!form) return;
  const data = new FormData(form); const num = (key: string) => Math.max(0, Number(String(data.get(key) || '').replace(',', '.')) || 0);
  const hours = num('hours'); const rate = num('rate'); const overtime = num('overtime'); const total = hours * rate + overtime * rate * 1.5;
  form.querySelector('[data-pay-result]')!.innerHTML = rate && (hours || overtime) ? `<strong>${money.format(total)}</strong><span>${hoursLabel(hours + overtime)} · ≈ ${money.format(total * 52 / 12)} a month if every week is like this</span>` : '<span>Enter hours and a rate.</span>';
}
function openShiftForm(day: string, shift?: Row) {
  state.editingShift = shift; const form = $('#shift-form') as HTMLFormElement; form.reset();
  const person = form.elements.namedItem('person') as HTMLSelectElement;
  person.innerHTML = state.members.map((m: Row) => `<option value="${escapeHtml(m.user_id)}">${escapeHtml(memberLabel(m.user_id))}</option>`).join('');
  person.value = shift?.person || (state.shiftPerson !== 'all' ? state.shiftPerson : state.user?.id || '');
  $('#shift-jobs').innerHTML = [...new Set(state.shifts.map(sh => sh.job).filter(Boolean))].map(job => `<option value="${escapeHtml(job)}"></option>`).join('');
  const set = (name: string, value: string) => { (form.elements.namedItem(name) as HTMLInputElement).value = value; };
  if (shift) { const s = wallInput(new Date(shift.starts_at)); const e = wallInput(new Date(shift.ends_at)); set('job', shift.job || ''); set('day', s.slice(0, 10)); set('start', s.slice(11)); set('end', e.slice(11)); set('break_minutes', String(shift.break_minutes || 0)); set('hourly_rate', shift.hourly_rate ?? ''); set('note', shift.note || ''); }
  else { const last = state.shifts.filter(sh => sh.person === person.value).slice(-1)[0]; set('day', day); set('job', last?.job || ''); set('start', last ? wallInput(new Date(last.starts_at)).slice(11) : '09:00'); set('end', last ? wallInput(new Date(last.ends_at)).slice(11) : '17:00'); set('break_minutes', String(last?.break_minutes || 0)); set('hourly_rate', last?.hourly_rate ?? ''); }
  $('#shift-title').textContent = shift ? 'Edit shift' : 'Add a shift'; $('#delete-shift').hidden = !shift;
  dialog('#shift-dialog').showModal();
}
async function saveShift(event: SubmitEvent) {
  event.preventDefault(); if (!supabase || !state.space || !state.user) return;
  const form = event.currentTarget as HTMLFormElement; const data = new FormData(form); const rate = formValue(data, 'hourly_rate').replace(',', '.');
  const times = shiftTimes(formValue(data, 'day'), formValue(data, 'start'), formValue(data, 'end'));
  if (!times.starts_at || !times.ends_at) { notify('Pick a day and both times.', true); return; }
  const row = { person: formValue(data, 'person'), job: formValue(data, 'job'), ...times, break_minutes: Number(formValue(data, 'break_minutes')) || 0, hourly_rate: rate === '' ? null : Number(rate), note: formValue(data, 'note') || null };
  const editing = state.editingShift;
  const { error } = editing ? await supabase.from('shifts').update(row).eq('id', editing.id) : await supabase.from('shifts').insert({ ...row, space_id: state.space.id, created_by: state.user.id });
  if (error) { notify(/relation .*shifts|schema cache/i.test(error.message) ? 'Shifts need the new database migration first.' : error.message, true); return; }
  dialog('#shift-dialog').close(); notify(editing ? 'Shift updated.' : 'Shift added.'); await refresh();
}
async function deleteShift() {
  const shift = state.editingShift; if (!supabase || !shift) return;
  const { error } = await supabase.from('shifts').delete().eq('id', shift.id); if (error) { notify(error.message, true); return; }
  dialog('#shift-dialog').close(); notify('Shift removed.'); await refresh();
}
async function copyLastWeekShifts() {
  if (!supabase || !state.space || !state.user) return; const start = shiftWeekStart();
  const rows = state.shifts.filter(sh => { const day = asDay(sh.starts_at); return day >= addDaysKey(start, -7) && day < start && (state.shiftPerson === 'all' || sh.person === state.shiftPerson); }).map(sh => {
    const s = wallInput(new Date(sh.starts_at)); const e = wallInput(new Date(sh.ends_at));
    return { space_id: state.space!.id, created_by: state.user.id, person: sh.person, job: sh.job, break_minutes: sh.break_minutes, hourly_rate: sh.hourly_rate, note: sh.note, ...shiftTimes(addDaysKey(s.slice(0, 10), 7), s.slice(11), e.slice(11)) };
  });
  const { error } = await supabase.from('shifts').insert(rows); if (error) { notify(error.message, true); return; }
  notify(`Copied ${rows.length} ${rows.length === 1 ? 'shift' : 'shifts'}.`); await refresh();
}
// Week ahead: the next seven days for both of you, what's carried over, who has how much on,
// and a nudge to put a date idea into a free slot. Meant for a Sunday-evening look together.
function renderWeek() {
  const node = $('#view-week'); if (!node) return;
  const from = dateKey(new Date()); const to = addDaysKey(from, 6); const fromIso = wallToIso(`${from}T00:00`)!; const toIso = wallToIso(`${addDaysKey(to, 1)}T00:00`)!;
  const entries = calendarEntries(true, 'all', from, to);
  const overdue = state.tasks.filter(t => !t.completed && t.due_at && asDay(t.due_at) < from);
  const load = state.members.map((m: Row) => {
    const id = m.user_id;
    const events = calendarEntries(false, 'all', from, to).filter(e => e.kind === 'event' && e.who === id).length;
    const shiftRows = state.shifts.filter(sh => sh.person === id && sh.starts_at >= fromIso && sh.starts_at < toIso);
    const tasks = state.tasks.filter(t => !t.completed && t.assigned_to === id && t.due_at && asDay(t.due_at) <= to).length;
    const hours = shiftRows.reduce((sum, sh) => sum + shiftHours(sh), 0);
    return { id, events, tasks, hours, shifts: shiftRows.length, score: events + tasks + hours / 4 };
  });
  const max = Math.max(1, ...load.map(l => l.score));
  const loadCard = state.members.length > 1 ? `<section>${sectionTitle('On each plate', 0)}<div class="surface load-card">${load.map(l => `<div class="load-row ${whoClass(l.id)}"><strong>${escapeHtml(memberLabel(l.id))}</strong><span class="load-bar"><span style="width:${Math.round(l.score / max * 100)}%"></span></span><small>${[l.shifts ? `${hoursLabel(l.hours)} work` : '', `${l.events} ${l.events === 1 ? 'event' : 'events'}`, `${l.tasks} ${l.tasks === 1 ? 'task' : 'tasks'}`].filter(Boolean).join(' · ')}</small></div>`).join('')}${(() => { const [a, b] = load; if (!a || !b) return ''; const busier = a.score > b.score * 1.5 ? a : b.score > a.score * 1.5 ? b : null; return busier ? `<p class="muted tiny">${escapeHtml(memberLabel(busier.id))} has a lot on this week. Maybe take something off their list?</p>` : '<p class="muted tiny">Nicely balanced this week.</p>'; })()}</div></section>` : '';
  const ideas = state.ideas.filter((i: Row) => !i.completed).sort((a: Row, b: Row) => Number(b.kind === 'date') - Number(a.kind === 'date')).slice(0, 3);
  const ideaCard = ideas.length && state.members.length > 1 ? `<section>${sectionTitle('Plan one together', ideas.length)}<div class="surface"><div class="list">${ideas.map((i: Row) => `<div class="row-item free-slot"><div class="row-content"><div class="row-title">${escapeHtml(i.title)}</div><div class="row-meta">${i.kind === 'date' ? 'Date idea' : i.kind === 'place' ? 'Place to visit' : 'Something to try'}</div></div><button class="button secondary small" data-plan-idea="${i.id}">Plan</button></div>`).join('')}</div></div></section>` : '';
  const carry = overdue.length ? `<section>${sectionTitle('Carried over', overdue.length)}<div class="surface"><div class="list">${overdue.map(taskRow).join('')}</div></div></section>` : '';
  node.innerHTML = `${heading('The week ahead', `${shortDate(from)} – ${shortDate(to)} · a few minutes together to see what’s coming.`)}<div class="today-grid"><div class="stack">${carry}<section>${sectionTitle('Day by day', 0)}<div class="surface">${Array.from({ length: 7 }, (_, i) => dayAgenda(addDaysKey(from, i), entries)).join('')}</div></section></div><div class="stack">${loadCard}${freeTogetherCard(4, 7)}${ideaCard}</div></div>`;
}
function render() { renderToday(); renderCalendar(); renderTasks(); renderLists(); renderPlans(); renderShifts(); renderWeek(); }
async function refresh() {
  if (!supabase || !state.user) return;
  // Only the first load shows a loading screen; later refreshes update in place. When
  // refreshes overlap, only the most recently started one is applied.
  // Queued list changes go out first, so the fresh copy from the server already includes them.
  if (navigator.onLine) await flushListOutbox();
  const seq = ++refreshSeq;
  if (!state.space) loading('Opening your space…');
  const { data: space, error: spaceError } = await supabase.from('spaces').select('id,name,timezone,owner_id').limit(1).maybeSingle();
  if (spaceError) { if(useOfflineSnapshot(spaceError))return;notify(spaceError.message, true); return; }
  state.space = space;
  $('#space-name').textContent = space?.name || 'Our space';
  if (space) {
    const { data: members, error: membersError } = await supabase.from('space_members').select('user_id').eq('space_id', space.id);
    if (membersError) { if(useOfflineSnapshot(membersError))return;notify(membersError.message, true); return; }
    $('#invite-button').hidden = space.owner_id !== state.user.id || (members?.length || 0) >= 2;
  } else $('#invite-button').hidden = true;
  if (!space) { dialog('#space-dialog').showModal(); return; }
  const [events, tasks, projects, goals] = await Promise.all([
    supabase.from('events').select('*').eq('space_id',space.id).order('starts_at'),
    supabase.from('tasks').select('*').eq('space_id',space.id).order('due_at',{ascending:true,nullsFirst:false}),
    supabase.from('projects').select('*').eq('space_id',space.id).order('created_at',{ascending:false}),
    supabase.from('goals').select('*').eq('space_id',space.id).order('created_at',{ascending:false}),
  ]);
  const failure=[events,tasks,projects,goals].find(result=>result.error)?.error;
  if(failure){if(useOfflineSnapshot(failure))return;notify(failure.message,true);return;}
  const [members, lists, ideas, activity, busy, shifts] = await Promise.all([
    supabase.from('space_members').select('user_id,display_name,role').eq('space_id',space.id),
    supabase.from('shared_lists').select('*').eq('space_id',space.id).order('created_at',{ascending:false}),
    supabase.from('shared_ideas').select('*').eq('space_id',space.id).order('created_at',{ascending:false}),
    supabase.from('completion_activity').select('id,item_type,title,completed_by,completed_at').eq('space_id',space.id).order('completed_at',{ascending:false}).limit(12),
    supabase.rpc('partner_busy',{p_space_id:space.id}),
    supabase.from('shifts').select('*').eq('space_id',space.id).gte('starts_at',new Date(Date.now()-400*86400000).toISOString()).order('starts_at'),
  ]);
  const extraFailure=[members,lists,ideas,activity].find(result=>result.error)?.error;
  if(extraFailure){if(useOfflineSnapshot(extraFailure))return;notify(extraFailure.message,true);return;}
  const listIds=(lists.data||[]).map((list:Row)=>list.id);
  const items=listIds.length?await supabase.from('shared_list_items').select('*').in('list_id',listIds).order('position').order('created_at'):{data:[],error:null};
  if(items.error){if(useOfflineSnapshot(items.error))return;notify(items.error.message,true);return;}
  if(seq!==refreshSeq)return;
  lastRefresh=Date.now();subscribeLive(space.id);
  // partner_busy is optional: before its migration is applied the calendar just has no busy blocks.
  state.busy=busy.error?[]:(busy.data as Row[])||[];
  // shifts is optional too, until its migration is applied.
  state.shifts=shifts.error?[]:(shifts.data as Row[])||[];
  state.events=events.data||[];state.tasks=tasks.data||[];state.projects=projects.data||[];state.goals=goals.data||[];
  state.members=members.data||[];state.lists=lists.data||[];state.ideas=ideas.data||[];state.listItems=items.data||[];state.activity=activity.data||[];state.offline=false;render();updateOfflineStatus();cacheSnapshot();
  $('#account-button').textContent=profileInitials(memberLabel(state.user.id));
  $('#account-button').setAttribute('aria-label',`Edit ${memberLabel(state.user.id)}’s profile`);
  $('#account-button').setAttribute('title',`Profile · ${memberLabel(state.user.id)}`);
  if(pendingShortcut==='task'){pendingShortcut=null;setView('tasks');openForm('task');}
  else if(pendingShortcut==='lists'){pendingShortcut=null;setView('lists');}
  else if(pendingView&&views.includes(pendingView)){setView(pendingView);pendingView=null;}
}
// Refresh when the other person changes something. Waits while someone is typing in a view.
function scheduleLiveRefresh() { window.clearTimeout(liveTimer);liveTimer=window.setTimeout(()=>{const active=document.activeElement;if(active instanceof HTMLInputElement&&active.closest('.view')){scheduleLiveRefresh();return;}void refresh();},700); }
function subscribeLive(spaceId:string) {
  if(!supabase||liveSpaceId===spaceId)return;
  stopLive();liveSpaceId=spaceId;
  let channel=supabase.channel(`sidequest-${spaceId}`);
  for(const table of ['events','tasks','projects','goals','shared_lists','shared_ideas','shifts'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`space_id=eq.${spaceId}`},scheduleLiveRefresh);
  liveChannel=channel.on('postgres_changes',{event:'*',schema:'public',table:'shared_list_items'},scheduleLiveRefresh).subscribe();
}
function stopLive() { if(supabase&&liveChannel)void supabase.removeChannel(liveChannel);liveChannel=null;liveSpaceId=''; }
function setView(view: string) { state.view=view; document.querySelectorAll('.view').forEach(node=>node.classList.toggle('active-view',node.id===`view-${view}`));document.querySelectorAll('[data-view]').forEach(node=>node.classList.toggle('active',node.getAttribute('data-view')===view)); }
function openAuth() { if (!configured) { notify('Add your Supabase URL and publishable key in .env.local to connect.', true); return; } dialog('#auth-dialog').showModal(); }
function clearInviteFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  window.history.replaceState({}, '', url);
  pendingInvite = null;
}
async function handleAuthenticatedUser(user: Row | null) {
  state.user = user;
  if (!user) {
    handledUserId = null;
    $('#account-button').hidden = true;
    $('#invite-button').hidden = true;
    stopLive();
    state.space = null; state.events = []; state.busy = []; state.shifts = []; state.tasks = []; state.projects = []; state.goals = [];
    state.members=[];state.lists=[];state.ideas=[];state.listItems=[];state.activity=[];
    render();
    return;
  }
  $('#account-button').hidden = false;
  if (handledUserId === user.id) return;
  handledUserId = user.id;
  if (pendingInvite && !acceptingInvite) {
    acceptingInvite = true;
    const { error } = await supabase!.rpc('accept_space_invitation', { p_token: pendingInvite });
    acceptingInvite = false;
    if (error) {
      handledUserId = null;
      notify('Invite not accepted. Sign in with the invited email address and try again.', true);
      if (!dialog('#auth-dialog').open) openAuth();
      return;
    }
    clearInviteFromUrl();
    const { error: metadataError } = await supabase!.auth.updateUser({ data: { sidequest_invite_token: null } });
    if (metadataError) console.warn('Could not clear the consumed invite token from account metadata.', metadataError);
    notify('You’ve joined your shared space.');
  }
  await refresh();
}
function input(name:string,label:string,type='text',value='',options:Record<string,string>={}) { const attrs=Object.entries(options).map(([key,val])=>`${key}="${escapeHtml(val)}"`).join(' '); return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs} /></label>`; }
function textarea(name:string,label:string,value='') { return `<label class="wide">${label}<textarea name="${name}" maxlength="1000">${escapeHtml(value)}</textarea></label>`; }
function select(name:string,label:string,options:Array<[string,string]>,value:string) { return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${escapeHtml(v)}" ${value===v?'selected':''}>${escapeHtml(l)}</option>`).join('')}</select></label>`; }
function dateInput(name:string,label:string,value?:string|null) { return input(name,label,'date',value?dateOnlyInput(value):''); }
function openForm(kind:Kind, record?:Row) {
  if(!state.space){notify('Create your space before adding plans.',true);return;}
  state.editing=record; const form=$('#form-fields'); const title=$('#form-title'); $('#form-kind').textContent=`${record?'Edit':'New'} ${kind}`; title.textContent=record?`Edit ${kind}`:`Add a ${kind}`;
    if(kind==='task') form.innerHTML=`<div class="quick-task-entry">${input('title','What needs doing?','text',record?.title||'',{required:'required',maxlength:'200',placeholder:'e.g. Milk tomorrow 5pm @Angie',autofocus:'autofocus'})}${quickAssigneeChoices(record?.assigned_to||'')}${!record?'<label class="add-another-option"><input name="add_another" type="checkbox" /><span>Add another after saving</span></label>':''}<details class="task-options" ${record?'open':''}><summary>More details <span>Date, repeat or note</span></summary><div class="form-grid task-extra">${select('assigned_to','Who’s taking this?',memberOptions(record?.assigned_to),record?.assigned_to||localGet(`sidequest:last-assignee:${state.user?.id}`))}${select('priority','Priority',[['low','Low'],['normal','Normal'],['high','High']],record?.priority||'normal')}${input('due_at','Due date and time','datetime-local',record?.due_at?wallInput(new Date(record.due_at)):'')}${select('recurrence_rule','Repeat',[['none','Does not repeat'],['daily','Every day'],['weekly','Every week'],['monthly','Every month']],record?.recurrence_rule||'none')}<label class="rotate-option"><input name="rotate_assignee" type="checkbox" ${record?.rotate_assignee?'checked':''} /><span>Take turns each time<small>Pass this repeating chore to the other person.</small></span></label>${input('reminder_at','Remind me','datetime-local',record?.reminder_at?wallInput(new Date(record.reminder_at)):'')}${select('project_id','Project',[['','No project'],...state.projects.map(p=>[p.id,p.title] as [string,string])],record?.project_id||'')}${textarea('description','A few details',record?.description||'')}</div></details></div>`;
  if(kind==='event'){
    // All-day events are stored as Warsaw midnight, so read their date in Warsaw (asDay), not from the UTC string.
    const allDay=Boolean(record?.all_day);const dayField=allDay?'date':'datetime-local';const prefill=state.prefillDay;state.prefillDay=undefined;
    const startValue=record?.starts_at?(allDay?asDay(record.starts_at):wallInput(new Date(record.starts_at))):prefill?(prefill.includes('T')?prefill:`${prefill}T18:00`):wallInput(new Date(Date.now()+3600000));
    const endValue=record?.ends_at?(allDay?asDay(record.ends_at):wallInput(new Date(record.ends_at))):'';
    const people:Array<[string,string]>=[['','Both of us'],...state.members.map((m:Row)=>[m.user_id,memberLabel(m.user_id)] as [string,string])];
    form.innerHTML=`<div class="form-grid">${input('title','What’s happening?','text',record?.title||'',{required:'required',maxlength:'200',placeholder:'e.g. Dinner with friends'})}${!missingColumns.has('person')?select('person','Who’s it for?',people,record?.person||''):''}${select('visibility','Who can see the details?',[['shared','Both of us'],['personal','Only me (partner sees “busy”)']],record?.visibility||'shared')}<label><span>All-day event</span><input name="all_day" type="checkbox" ${allDay?'checked':''} style="width:18px;height:18px;accent-color:#82917A" /></label>${input('starts_at','Starts',dayField,startValue,{required:'required'})}${input('ends_at',allDay?'Last day (optional)':'Ends (optional)',dayField,endValue)}${input('location','Where?','text',record?.location||'',{maxlength:'200',placeholder:'Optional'})}${!missingColumns.has('recurrence')?`${select('recurrence','Repeats',[['none','Doesn’t repeat'],['weekly','Every week'],['monthly','Every month'],['yearly','Every year']],record?.recurrence||'none')}${input('repeat_until','Repeat until (optional)','date',record?.repeat_until||'')}`:''}${!missingColumns.has('remind_minutes')?select('remind_minutes','Remind',[['','No reminder'],['10','10 min before'],['60','1 hour before'],['1440','1 day before']],record?.remind_minutes==null?'':String(record.remind_minutes)):''}${textarea('description','A few details',record?.description||'')}</div>`;
  }
  if(kind==='project') form.innerHTML=`<div class="form-grid">${input('title','Project name','text',record?.title||'',{required:'required',maxlength:'160',placeholder:'e.g. Plan a weekend away'})}${select('status','Status',[['planned','Planned'],['active','Active'],['done','Done']],record?.status||'planned')}${dateInput('start_date','Start date',record?.start_date)}${dateInput('target_date','Target date',record?.target_date)}${textarea('description','A few details',record?.description||'')}</div>`;
  if(kind==='goal') form.innerHTML=`<div class="form-grid">${input('title','Goal','text',record?.title||'',{required:'required',maxlength:'160',placeholder:'e.g. Take a trip somewhere new'})}${input('progress','Progress (%)','number',String(record?.progress??0),{min:'0',max:'100',step:'1',required:'required'})}${dateInput('target_date','Target date',record?.target_date)}${textarea('description','A few details',record?.description||'')}</div>`;
  const allDay=form.querySelector<HTMLInputElement>('[name="all_day"]');
  allDay?.addEventListener('change',()=>{for(const name of ['starts_at','ends_at']){const field=form.querySelector<HTMLInputElement>(`[name="${name}"]`);if(!field)continue;const date=field.value.split('T')[0];field.type=allDay.checked?'date':'datetime-local';field.value=allDay.checked?date:(date?`${date}T09:00`:wallInput(new Date()));}});
  $('#save-item').textContent=record?'Save changes':kind==='task'?'Add task':'Save';
  ($('#delete-item') as HTMLButtonElement).hidden=!record;
  dialog('#item-dialog').showModal();
  if(kind==='task'&&!record) requestAnimationFrame(()=>form.querySelector<HTMLInputElement>('[name="title"]')?.focus());
  if(kind==='event'&&!record){const titleInput=form.querySelector<HTMLInputElement>('[name="title"]')!;titleInput.placeholder='e.g. Dinner Fri 19:00 both';titleInput.oninput=()=>applyQuickEvent(titleInput.form!);requestAnimationFrame(()=>titleInput.focus());}
}
// Quick-add for events: "Dinner Fri 19:00 both" or "Dentist tomorrow 9:30 @Angie" fills the day, time and who.
function parseQuickEvent(raw:string) { const both=/\b(both|us)\b/i.test(raw);const parsed=parseQuickTaskInput(raw.replace(/\b(both|us)\b/i,' '));return {...parsed,both}; }
function applyQuickEvent(form:HTMLFormElement) {
  const parsed=parseQuickEvent((form.elements.namedItem('title') as HTMLInputElement).value);if(!parsed.due)return;
  const start=form.elements.namedItem('starts_at') as HTMLInputElement;if(start.type!=='datetime-local')return;start.value=wallInput(new Date(parsed.due));
  const person=form.elements.namedItem('person') as HTMLSelectElement|null;if(person&&(parsed.assignee||parsed.both))person.value=parsed.assignee||'';
  form.dataset.quickTitle=parsed.title;
}
function formValue(data:FormData,key:string) { return String(data.get(key)||'').trim(); }
function parseQuickTaskInput(raw:string) {
  let title=raw.trim();let assignee:string|null=null;let due:string|null=null;
  for(const member of state.members){const token=`@${memberLabel(member.user_id).split(/\s+/)[0]}`;const found=title.split(/\s+/).find(word=>word.toLowerCase()===token.toLowerCase());if(found){assignee=member.user_id;title=title.replace(found,' ').replace(/\s+/g,' ').trim();break;}}
  const now=new Date();const base=todayAtNoon();const weekday=new Date(`${dateKey(now)}T00:00:00Z`).getUTCDay();let offset:number|null=null;
  if(/\btoday\b/i.test(title)){offset=0;title=title.replace(/\btoday\b/i,' ');}else if(/\btomorrow\b/i.test(title)){offset=1;title=title.replace(/\btomorrow\b/i,' ');}else{const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const match=title.match(/\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i);if(match){const target=weekdays.findIndex(day=>day.startsWith(match[1].toLowerCase().slice(0,3)));offset=(target-weekday+7)%7||7;title=title.replace(match[0],' ');}}
  const time=title.match(/\b(?:at\s*)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b|\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if(time){let hour:number;let minute:number;if(time[3]){hour=Number(time[1])%12+(time[3].toLowerCase()==='pm'?12:0);minute=Number(time[2]||0);}else{hour=Number(time[4]);minute=Number(time[5]);}title=title.replace(time[0],' ');if(offset===null)offset=0;const day=daysFrom(base,offset);due=wallToIso(`${dateKey(day)}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`);}else if(offset!==null){const day=daysFrom(base,offset);due=wallToIso(`${dateKey(day)}T09:00`);}
  return {title:title.replace(/\s+/g,' ').trim(),assignee,due};
}
async function saveItem(event:SubmitEvent) {
  event.preventDefault(); if(!supabase||!state.user||!state.space)return;
  const form=event.currentTarget as HTMLFormElement; const data=new FormData(form);const kind=$('#form-kind').textContent?.replace(/^(New|Edit) /,'') as Kind;const record=state.editing;const payload:Row={space_id:state.space.id};
  const addAnother=kind==='task'&&!record&&data.get('add_another')==='on';
  let title=formValue(data,'title');if(kind==='event'&&!record&&form.dataset.quickTitle&&parseQuickEvent(title).title===form.dataset.quickTitle){title=form.dataset.quickTitle;}delete form.dataset.quickTitle;if(!title){notify('Add a title before saving.',true);return;}
  const quick=kind==='task'&&!record?parseQuickTaskInput(title):null;payload.title=quick?quick.title:title;payload.created_by=state.user.id;
  if(kind==='task'){payload.description=formValue(data,'description')||null;payload.priority=formValue(data,'priority');payload.project_id=formValue(data,'project_id')||null;payload.assigned_to=quick?.assignee||formValue(data,'assigned_to')||null;payload.recurrence_rule=formValue(data,'recurrence_rule')||'none';payload.rotate_assignee=data.get('rotate_assignee')==='on';const due=formValue(data,'due_at');const reminder=formValue(data,'reminder_at');payload.due_at=due?wallToIso(due):(quick?.due||null);payload.reminder_at=reminder?wallToIso(reminder):null;payload.reminder_sent_at=null;payload.reminder_claimed_at=null;payload.completed=record?.completed??false;}
  if(kind==='task'&&!payload.title){notify('Add a task description before any date or name tags.',true);return;}
  if(kind==='task'&&!record)payload.id=crypto.randomUUID();
  if(kind==='event'){payload.description=formValue(data,'description')||null;payload.location=formValue(data,'location')||null;payload.visibility=formValue(data,'visibility');const allDay=data.get('all_day')==='on';const start=formValue(data,'starts_at');const end=formValue(data,'ends_at');payload.starts_at=wallToIso(allDay?`${start}T00:00`:start);payload.ends_at=end?wallToIso(allDay?`${end}T00:00`:end):null;payload.all_day=allDay;if(data.has('person'))payload.person=formValue(data,'person')||null;if(data.has('remind_minutes'))payload.remind_minutes=formValue(data,'remind_minutes')?Number(formValue(data,'remind_minutes')):null;if(data.has('recurrence')){payload.recurrence=formValue(data,'recurrence')||'none';payload.repeat_until=payload.recurrence==='none'?null:formValue(data,'repeat_until')||null;if(payload.repeat_until&&payload.repeat_until<start.slice(0,10)){notify('“Repeat until” needs to be after the first date.',true);return;}}if(payload.ends_at&&payload.ends_at<payload.starts_at){notify('The end time needs to be after the start time.',true);return;}}
  if(kind==='project'){payload.description=formValue(data,'description')||null;payload.status=formValue(data,'status');payload.start_date=formValue(data,'start_date')||null;payload.target_date=formValue(data,'target_date')||null;if(payload.start_date&&payload.target_date&&payload.target_date<payload.start_date){notify('The target date must be after the start date.',true);return;}}
  if(kind==='goal'){payload.description=formValue(data,'description')||null;payload.target_date=formValue(data,'target_date')||null;payload.progress=Number(formValue(data,'progress'));if(!Number.isInteger(payload.progress)||payload.progress<0||payload.progress>100){notify('Progress must be a whole number from 0 to 100.',true);return;}}
  const table=kind==='task'?'tasks':kind==='event'?'events':kind==='project'?'projects':'goals';let result;
  const write=()=>record?supabase!.from(table).update(payload).eq('id',record.id).eq('space_id',state.space!.id).select('id').maybeSingle():supabase!.from(table).insert(payload).select('id').maybeSingle();
  if(record) { delete payload.created_by; delete payload.space_id;result=await write(); }
  else if(kind==='task'&&!navigator.onLine){queueOfflineTask(payload);if(addAnother)continueAddingTask(form);else{dialog('#item-dialog').close();form.reset();}return;}
  else result=await write();
  // Before the events.person migration is applied, save without it and stop offering the field.
  const wantedRepeat=payload.recurrence&&payload.recurrence!=='none';
  for(const column of ['person','recurrence','repeat_until','remind_minutes']){if(result?.error&&column in payload&&result.error.message.includes(column)){missingColumns.add(column);if(column==='recurrence')missingColumns.add('repeat_until');delete payload[column];if(column==='recurrence')delete payload.repeat_until;result=await write();}}
  const repeatDropped=Boolean(wantedRepeat&&missingColumns.has('recurrence'));
  if(result?.error){if(kind==='task'&&!record&&isNetworkError(result.error)){if(!state.space)restoreSnapshot();queueOfflineTask(payload);if(addAnother)continueAddingTask(form);else{dialog('#item-dialog').close();form.reset();}return;}notify(result.error.message,true);return;}if(record&&!result?.data){notify('This item could not be updated. Check your space access.',true);return;}
  if(kind==='task'&&payload.assigned_to)localSet(`sidequest:last-assignee:${state.user.id}`,payload.assigned_to);if(addAnother){form.reset();continueAddingTask(form);await refresh();notify('Task added. Ready for another.');return;}dialog('#item-dialog').close();form.reset();const goalReached=kind==='goal'&&record&&record.progress<100&&payload.progress===100;if(repeatDropped)notify('Saved, but repeating events need a database update first.',true);else notify(goalReached?`You reached “${title}” together. Take a moment to enjoy it ✨`:record?'Changes saved.':`${kind[0].toUpperCase()+kind.slice(1)} added.`);await refresh();
}
function continueAddingTask(form:HTMLFormElement) { const keep=form.querySelector<HTMLInputElement>('[name="add_another"]');form.reset();if(keep)keep.checked=true;const assignee=form.querySelector<HTMLSelectElement>('[name="assigned_to"]');if(assignee)assignee.value=localGet(`sidequest:last-assignee:${state.user?.id}`);const selected=assignee?.value||'';form.querySelectorAll<HTMLElement>('[data-quick-assignee]').forEach(button=>{const active=button.dataset.quickAssignee===selected;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});form.querySelector<HTMLInputElement>('[name="title"]')?.focus();}
function queueOfflineTask(payload:Row) { if(!state.user)return;const task={...payload,id:payload.id||crypto.randomUUID(),created_at:new Date().toISOString(),offline_pending:true};const queue=localJson<Row[]>(outboxKey(state.user.id),[]);queue.push(task);localSet(outboxKey(state.user.id),queue);if(payload.assigned_to)localSet(`sidequest:last-assignee:${state.user.id}`,payload.assigned_to);state.tasks.unshift(task);state.offline=true;cacheSnapshot();render();updateOfflineStatus();notify('Saved on this phone. It will sync when you’re back online.'); }
async function flushTaskOutbox() { if(!supabase||!state.user||!navigator.onLine)return;if(!await flushListOutbox())return;const queue=localJson<Row[]>(outboxKey(state.user.id),[]);if(!queue.length){await refresh();return;}const remaining:Row[]=[];for(const task of queue){const {offline_pending,...payload}=task;const {error}=await supabase.from('tasks').upsert(payload,{onConflict:'id'});if(error){remaining.push(task);continue;}state.tasks=state.tasks.map(row=>row.id===task.id?{...row,offline_pending:false}:row);}localSet(outboxKey(state.user.id),remaining);if(remaining.length){notify('Some offline tasks are still waiting to sync.',true);return;}state.offline=false;cacheSnapshot();render();updateOfflineStatus();await refresh();notify('Your offline tasks are synced.');}
async function undoTaskCompletion(task:Row,nextTask?:Row) { if(!supabase||!state.space)return;if(nextTask){const {error:deleteError}=await supabase.from('tasks').delete().eq('id',nextTask.id).eq('space_id',state.space.id);if(deleteError){notify('Could not undo the repeating task. Try again from Tasks.',true);return;}}const {error}=await supabase.from('tasks').update({completed:false}).eq('id',task.id).eq('space_id',state.space.id);if(error){if(nextTask)await supabase.from('tasks').insert(nextTask);notify(error.message,true);return;}await refresh();notify('Task restored to your list.');}
async function toggleTask(id:string) { if(!supabase)return;const task=state.tasks.find(t=>t.id===id);if(!task)return;const completing=!task.completed;const before=new Set(state.tasks.map(row=>row.id));const {data,error}=await supabase.from('tasks').update({completed:completing}).eq('id',id).eq('space_id',state.space?.id).select('id').maybeSingle();if(error){notify(error.message,true);return;}if(!data){notify('This task could not be changed. Check your space access.',true);return;}await refresh();if(completing){const next=task.recurrence_rule&&task.recurrence_rule!=='none'?state.tasks.find(row=>!before.has(row.id)&&row.title===task.title&&row.recurrence_rule===task.recurrence_rule):undefined;notifyActionButton(`A little win: ${task.title} is done ✨`,'Undo',()=>undoTaskCompletion(task,next));}else notify('Back on the list. You’ve got this.'); }
async function rescheduleOverdueTask(id:string,action:'today'|'tomorrow'|'clear') { if(!supabase||!state.space)return;const task=state.tasks.find(row=>row.id===id);if(!task)return;const due=action==='clear'?null:action==='today'?wallToIso(`${dateKey(new Date())}T23:59`):wallToIso(`${dateKey(daysFrom(todayAtNoon(),1))}T09:00`);const {data,error}=await supabase.from('tasks').update({due_at:due}).eq('id',id).eq('space_id',state.space.id).select('id').maybeSingle();if(error||!data){notify(error?.message||'Could not update this task.',true);return;}await refresh();const label=action==='clear'?'Removed the due date.':action==='today'?'Moved to later today.':'Moved to tomorrow morning.';notifyActionButton(label,'Undo',async()=>{const result=await supabase!.from('tasks').update({due_at:task.due_at}).eq('id',id).eq('space_id',state.space!.id);if(result.error){notify(result.error.message,true);return;}await refresh();notify('Due date restored.');});}
async function restoreDeletedTask(task:Row) { if(!supabase||!state.space)return;const {error}=await supabase.from('tasks').insert(task);if(error){notify(error.message,true);return;}await refresh();notify('Task restored.');}
async function deleteCurrentItem() { const record=state.editing;const kind=$('#form-kind').textContent?.replace(/^(New|Edit) /,'') as Kind;if(!supabase||!state.space||!record)return;if(!window.confirm(`Delete “${record.title}”?${kind==='task'?' You can undo for a few seconds.':' This cannot be undone.'}`))return;const table=({task:'tasks',event:'events',project:'projects',goal:'goals'} as const)[kind];const {data,error}=await supabase.from(table).delete().eq('id',record.id).eq('space_id',state.space.id).select('*').maybeSingle();if(error||!data){notify(error?.message||'Could not delete this item. Check your space access.',true);return;}dialog('#item-dialog').close();state.editing=undefined;await refresh();if(kind==='task')notifyActionButton('Task deleted.','Undo',()=>restoreDeletedTask(data));else notify(`${kind[0].toUpperCase()+kind.slice(1)} deleted.`); }
async function snoozeTask(id:string,when:'hour'|'tomorrow') { if(!supabase||!state.space)return;const task=state.tasks.find(row=>row.id===id);if(!task)return;const reminder=when==='hour'?new Date(Date.now()+3600000):new Date(wallToIso(`${dateKey(daysFrom(todayAtNoon(),1))}T09:00`)||Date.now());const {error}=await supabase.from('tasks').update({reminder_at:reminder.toISOString(),reminder_sent_at:null,reminder_claimed_at:null}).eq('id',id).eq('space_id',state.space.id);if(error){notify(error.message,true);return;}notify(when==='hour'?'Reminder snoozed for an hour.':'I’ll remind you tomorrow morning.');await refresh();setView('tasks'); }
async function completeGoal(id:string) { if(!supabase||!state.space)return;const goal=state.goals.find(row=>row.id===id);if(!goal)return;const {data,error}=await supabase.from('goals').update({progress:100}).eq('id',id).eq('space_id',state.space.id).select('id').maybeSingle();if(error||!data){notify(error?.message||'Could not update this goal.',true);return;}notify(`You reached “${goal.title}” together. Take a moment to enjoy it ✨`);await refresh(); }
async function manageDevices() { if(!supabase)return;if(!('PushManager' in window)){notify('Push reminders are not supported in this browser.',true);return;}const {data,error}=await supabase.from('push_subscriptions').select('id,endpoint,created_at').order('created_at',{ascending:false});if(error){notify(error.message,true);return;}state.pushDevices=data||[];const current=await (await navigator.serviceWorker.ready).pushManager.getSubscription();$('#device-list').innerHTML=state.pushDevices.length?`<div class="list">${state.pushDevices.map((device:Row)=>{let host='Browser device';try{host=new URL(device.endpoint).hostname.replace(/^www\./,'');}catch{}const isCurrent=current?.endpoint===device.endpoint;return `<div class="device-row"><div><strong>${isCurrent?'This device':escapeHtml(host)}</strong><small>${isCurrent?'Reminders are active here':`Added ${itemDate(device.created_at)}`}</small></div><button class="text-button" data-remove-device="${device.id}" data-endpoint="${escapeHtml(device.endpoint)}">Remove</button></div>`;}).join('')}</div>`:empty('No reminder devices yet','Turn on reminders in Tasks to add this device.','☼');dialog('#devices-dialog').showModal(); }
async function removeDevice(id:string,endpoint:string) { if(!supabase)return;try{const subscription=await (await navigator.serviceWorker.ready).pushManager.getSubscription();if(subscription?.endpoint===endpoint)await subscription.unsubscribe();}catch(error){console.warn('Could not unsubscribe this browser.',error);}const {error}=await supabase.from('push_subscriptions').delete().eq('id',id);if(error){notify(error.message,true);return;}notify('Reminder device removed.');await manageDevices(); }
async function createList(event:SubmitEvent) { event.preventDefault();if(!supabase||!state.space||!state.user)return;const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);const {error}=await supabase.from('shared_lists').insert({space_id:state.space.id,title:formValue(data,'title'),list_type:formValue(data,'list_type'),created_by:state.user.id});if(error){notify(error.message,true);return;}dialog('#list-dialog').close();form.reset();notify('Your shared list is ready.');await refresh();setView('lists'); }
function rememberListItem(listId:string,title:string) { const key=`sidequest:recent-list:${state.user!.id}:${listId}`;localSet(key,[title,...localJson<string[]>(key,[]).filter(item=>item.toLowerCase()!==title.toLowerCase())].slice(0,8)); }
// Adds an item and keeps the cursor in that list's box, so several items can be typed in a row.
// List changes made with no signal are kept on this phone and replayed in order when it reconnects.
type ListOp = { op: 'add'; id: string; list_id: string; title: string } | { op: 'tick'; id: string; completed: boolean } | { op: 'delete'; id: string } | { op: 'clear'; list_id: string };
const listOutboxKey=(userId:string)=>`sidequest:list-outbox:${userId}`;
function queueListOp(op:ListOp) { if(!state.user)return;const queue=localJson<ListOp[]>(listOutboxKey(state.user.id),[]);queue.push(op);localSet(listOutboxKey(state.user.id),queue);state.offline=true;cacheSnapshot();updateOfflineStatus(); }
async function sendListOp(op:ListOp) {
  const items=supabase!.from('shared_list_items');
  if(op.op==='add')return (await items.upsert({id:op.id,list_id:op.list_id,title:op.title,created_by:state.user.id},{onConflict:'id'})).error;
  if(op.op==='tick')return (await items.update({completed:op.completed}).eq('id',op.id)).error;
  if(op.op==='delete')return (await items.delete().eq('id',op.id)).error;
  return (await items.delete().eq('list_id',op.list_id).eq('completed',true)).error;
}
// Runs a list change now, or queues it when there is no connection. Returns false only on a real error.
async function runListOp(op:ListOp) {
  if(!supabase||!state.user)return false;
  if(!navigator.onLine||localJson<ListOp[]>(listOutboxKey(state.user.id),[]).length){queueListOp(op);return true;}
  const error=await sendListOp(op);
  if(error&&isNetworkError(error)){queueListOp(op);return true;}
  if(error){notify(error.message,true);return false;}
  return true;
}
async function flushListOutbox() {
  if(!supabase||!state.user||!navigator.onLine)return true;const key=listOutboxKey(state.user.id);const queue=localJson<ListOp[]>(key,[]);if(!queue.length)return true;
  while(queue.length){const error=await sendListOp(queue[0]);if(error&&isNetworkError(error)){localSet(key,queue);return false;}queue.shift();localSet(key,queue);}
  notify('Your list changes are synced.');return true;
}
async function insertListItem(listId:string,title:string) {
  if(!supabase||!state.user)return false;
  const item={id:crypto.randomUUID(),list_id:listId,title,completed:false,created_by:state.user.id,created_at:new Date().toISOString()};
  state.listItems=[...state.listItems,item];renderLists();
  if(!await runListOp({op:'add',id:item.id,list_id:listId,title})){state.listItems=state.listItems.filter((row:Row)=>row.id!==item.id);renderLists();return false;}
  rememberListItem(listId,title);if(!state.offline)await refresh();else{cacheSnapshot();renderLists();}
  $(`[data-list-item-form="${listId}"] input[name="title"]`)?.focus();
  return true;
}
// The submit listener is delegated on document, so the form is event.target, not currentTarget.
async function addListItem(event:SubmitEvent) { event.preventDefault();const form=event.target as HTMLFormElement;const listId=form.dataset.listItemForm;const title=formValue(new FormData(form),'title');if(!listId||!title)return;form.reset();if(!await insertListItem(listId,title))(form.elements.namedItem('title') as HTMLInputElement).value=title; }
async function addRecentListItem(listId:string,title:string) { await insertListItem(listId,title); }
// Ticks and removals show instantly and are rolled back if the save fails.
async function toggleListItem(id:string) { if(!supabase)return;const item=state.listItems.find((row:Row)=>row.id===id);if(!item)return;item.completed=!item.completed;renderLists();if(!await runListOp({op:'tick',id,completed:item.completed})){item.completed=!item.completed;renderLists();}else cacheSnapshot(); }
async function deleteListItem(id:string) { if(!supabase)return;const before=state.listItems;state.listItems=before.filter((row:Row)=>row.id!==id);renderLists();if(!await runListOp({op:'delete',id})){state.listItems=before;renderLists();}else cacheSnapshot(); }
async function clearTicked(listId:string) { if(!supabase)return;const before=state.listItems;state.listItems=before.filter((row:Row)=>!(row.list_id===listId&&row.completed));renderLists();if(!await runListOp({op:'clear',list_id:listId})){state.listItems=before;renderLists();return;}cacheSnapshot();notify('Ticked items cleared.'); }
async function deleteList(listId:string) { if(!supabase||!state.space)return;const list=state.lists.find((row:Row)=>row.id===listId);if(!list||!window.confirm(`Delete the list “${list.title}” and everything on it?`))return;const {error}=await supabase.from('shared_lists').delete().eq('id',listId).eq('space_id',state.space.id);if(error){notify(error.message,true);return;}notify('List deleted.');await refresh(); }
async function saveIdea(event:SubmitEvent) { event.preventDefault();if(!supabase||!state.space||!state.user)return;const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);const {error}=await supabase.from('shared_ideas').insert({space_id:state.space.id,kind:formValue(data,'kind'),title:formValue(data,'title'),details:formValue(data,'details')||null,created_by:state.user.id});if(error){notify(error.message,true);return;}dialog('#idea-dialog').close();form.reset();notify('Saved for a good day.');await refresh();setView('plans');state.planTab='ideas';renderPlans(); }
async function saveProfile(event:SubmitEvent) { event.preventDefault();if(!supabase||!state.space||!state.user)return;const form=event.currentTarget as HTMLFormElement;const displayName=formValue(new FormData(form),'display_name');if(!displayName){notify('Add a name before saving.',true);return;}const {data,error}=await supabase.from('space_members').update({display_name:displayName}).eq('space_id',state.space.id).eq('user_id',state.user.id).select('user_id').maybeSingle();if(error||!data){notify(error?.message||'Could not update your profile. Please try again.',true);return;}dialog('#profile-dialog').close();notify('Your name is updated.');await refresh(); }
async function toggleIdea(id:string) { if(!supabase)return;const idea=state.ideas.find((row:Row)=>row.id===id);if(!idea)return;const {error}=await supabase.from('shared_ideas').update({completed:!idea.completed}).eq('id',id);if(error){notify(error.message,true);return;}await refresh();state.planTab='ideas';renderPlans(); }
async function deleteIdea(id:string) { if(!supabase)return;const {error}=await supabase.from('shared_ideas').delete().eq('id',id);if(error){notify(error.message,true);return;}await refresh();state.planTab='ideas';renderPlans(); }
function isInstalledPwa() { return window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true; }
async function enableReminders() {
  if(typeof Notification==='undefined'){notify('Notifications are not supported in this browser.',true);return;}
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!isInstalledPwa()){dialog('#install-dialog').showModal();notify('On iPhone, add Sidequest to your Home Screen before enabling notifications.');return;}
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){notify('Notifications were not enabled.',true);return;}
  try {
    const registration = await navigator.serviceWorker.ready;
    const { data, error } = await supabase!.functions.invoke('sidequest-reminders', { body: { action: 'public-key' } });
    if (error || !data?.publicKey) throw error || new Error('Could not load the notification key.');
    const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(data.publicKey) });
    const { error: saveError } = await supabase!.from('push_subscriptions').upsert({ endpoint: subscription.endpoint, subscription: subscription.toJSON() }, { onConflict: 'endpoint' });
    if (saveError) throw saveError;
    notify('Background reminders are ready on this device.');
  } catch (error) {
    console.error('Could not enable background reminders.', error);
    notify('Could not enable reminders. Please try again.', true);
  }
}
function decodeVapidKey(value: string) { const padding='='.repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,char=>char.charCodeAt(0)); }
// A secret subscription link for Google/Apple Calendar. Creating a new one turns off the old one.
async function createCalendarFeed() {
  if(!supabase)return;const button=$('#feed-button') as HTMLButtonElement;button.disabled=true;
  const {data,error}=await supabase.rpc('rotate_calendar_feed');button.disabled=false;
  if(error||!data){notify(/rotate_calendar_feed|function/i.test(error?.message||'')?'The calendar link isn’t set up in Supabase yet.':error?.message||'Could not create a calendar link.',true);return;}
  const url=`${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/sidequest-calendar?token=${data}`;const webcal=url.replace(/^https:/,'webcal:');
  ($('#feed-link') as HTMLInputElement).value=url;
  $('#feed-apple').setAttribute('href',webcal);
  $('#feed-google').setAttribute('href',`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`);
  $('#feed-result').hidden=false;button.textContent='Make a new link (turns off the old one)';
}
function bindEvents() {
  document.addEventListener('click',async event=>{const target=event.target as HTMLElement;const view=target.closest<HTMLElement>('[data-view]');if(view){setView(view.dataset.view!);return;}
    if(target.closest('[data-notice-action]')){const action=noticeAction;noticeAction=null;if(action)await action();return;}
    const assignee=target.closest<HTMLElement>('[data-quick-assignee]');if(assignee){const select=$('#form-fields select[name="assigned_to"]') as HTMLSelectElement;select.value=assignee.dataset.quickAssignee||'';document.querySelectorAll<HTMLElement>('[data-quick-assignee]').forEach(button=>{const selected=button.dataset.quickAssignee===select.value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});return;}
    if(target.closest('[data-toggle-focus]')){state.focusOnly=!state.focusOnly;renderToday();return;}
    const recentItem=target.closest<HTMLElement>('[data-recent-list-item]');if(recentItem){await addRecentListItem(recentItem.dataset.recentListItem!,recentItem.dataset.title!);return;}
    const snooze=target.closest<HTMLElement>('[data-snooze-task]');if(snooze){await snoozeTask(snooze.dataset.snoozeTask!,snooze.dataset.snooze as 'hour'|'tomorrow');return;}
    const overdue=target.closest<HTMLElement>('[data-overdue-task]');if(overdue){await rescheduleOverdueTask(overdue.dataset.overdueTask!,overdue.dataset.overdueAction as 'today'|'tomorrow'|'clear');return;}
    const removeDeviceButton=target.closest<HTMLElement>('[data-remove-device]');if(removeDeviceButton){await removeDevice(removeDeviceButton.dataset.removeDevice!,removeDeviceButton.dataset.endpoint!);return;}
    const completeGoalButton=target.closest<HTMLElement>('[data-complete-goal]');if(completeGoalButton){await completeGoal(completeGoalButton.dataset.completeGoal!);return;}
    if(target.closest('[data-manage-devices]')){await manageDevices();return;}
    const create=target.closest<HTMLElement>('[data-create]');if(create){dialog('#add-dialog').close();openForm(create.dataset.create as Kind);return;}
    if(target.closest('[data-open-list-dialog]')){dialog('#list-dialog').showModal();return;}
    if(target.closest('[data-open-idea-dialog]')){dialog('#idea-dialog').showModal();return;}
    const listCheck=target.closest<HTMLElement>('[data-toggle-list-item]');if(listCheck){await toggleListItem(listCheck.dataset.toggleListItem!);return;}
    const clear=target.closest<HTMLElement>('[data-clear-ticked]');if(clear){await clearTicked(clear.dataset.clearTicked!);return;}
    const listRemove=target.closest<HTMLElement>('[data-delete-list]');if(listRemove){await deleteList(listRemove.dataset.deleteList!);return;}
    const taskPerson=target.closest<HTMLElement>('[data-task-person]');if(taskPerson){state.taskPerson=taskPerson.dataset.taskPerson||'all';localSet('sidequest:task-person',state.taskPerson);renderTasks();return;}
    const listDelete=target.closest<HTMLElement>('[data-delete-list-item]');if(listDelete){await deleteListItem(listDelete.dataset.deleteListItem!);return;}
    const ideaCheck=target.closest<HTMLElement>('[data-toggle-idea]');if(ideaCheck){await toggleIdea(ideaCheck.dataset.toggleIdea!);return;}
    const ideaDelete=target.closest<HTMLElement>('[data-delete-idea]');if(ideaDelete){await deleteIdea(ideaDelete.dataset.deleteIdea!);return;}
    if(target.closest('[data-enable-reminders]')){await enableReminders();return;}
    const edit=target.closest<HTMLElement>('[data-edit]');if(edit){const kind=edit.dataset.edit as Kind;const row=({task:state.tasks,event:state.events,project:state.projects,goal:state.goals}[kind]).find(i=>i.id===edit.dataset.id);if(row)openForm(kind,row);return;}
    const toggle=target.closest<HTMLElement>('[data-toggle-task]');if(toggle){await toggleTask(toggle.dataset.toggleTask!);return;}
    const filter=target.closest<HTMLElement>('[data-task-filter]');if(filter){state.taskFilter=filter.dataset.taskFilter!;renderTasks();return;}
    const tab=target.closest<HTMLElement>('[data-plan-tab]');if(tab){state.planTab=tab.dataset.planTab!;renderPlans();return;}
    const step=target.closest<HTMLElement>('[data-calendar-step]');if(step){state.calendarOffset+=Number(step.dataset.calendarStep);state.selectedDay='';renderCalendar();return;}
    if(target.closest('[data-calendar-day]')){state.calendarOffset=0;state.selectedDay=dateKey(new Date());renderCalendar();return;}
    const mode=target.closest<HTMLElement>('[data-calendar-mode]');if(mode){state.calendarMode=mode.dataset.calendarMode==='month'?'month':'week';state.calendarOffset=0;state.selectedDay='';localSet('sidequest:calendar-mode',state.calendarMode);renderCalendar();return;}
    const person=target.closest<HTMLElement>('[data-calendar-person]');if(person){state.calendarPerson=person.dataset.calendarPerson||'all';renderCalendar();return;}
    if(target.closest('[data-toggle-cal-tasks]')){state.showTasks=!state.showTasks;localSet('sidequest:calendar-tasks',state.showTasks?'1':'0');renderCalendar();return;}
    const pick=target.closest<HTMLElement>('[data-calendar-select]');if(pick){state.selectedDay=pick.dataset.calendarSelect!;renderCalendar();return;}
    const addShift=target.closest<HTMLElement>('[data-add-shift]');if(addShift){openShiftForm(addShift.dataset.addShift||dateKey(new Date()));return;}
    const editShift=target.closest<HTMLElement>('[data-edit-shift]');if(editShift){const shift=state.shifts.find(sh=>sh.id===editShift.dataset.editShift);if(shift)openShiftForm(asDay(shift.starts_at),shift);return;}
    const shiftStep=target.closest<HTMLElement>('[data-shift-step]');if(shiftStep){const step=Number(shiftStep.dataset.shiftStep);state.shiftOffset=step?state.shiftOffset+step:0;renderShifts();return;}
    const shiftPerson=target.closest<HTMLElement>('[data-shift-person]');if(shiftPerson){state.shiftPerson=shiftPerson.dataset.shiftPerson||'all';renderShifts();return;}
    if(target.closest('[data-copy-shifts]')){await copyLastWeekShifts();return;}
    const planIdea=target.closest<HTMLElement>('[data-plan-idea]');if(planIdea){const idea=state.ideas.find((i:Row)=>i.id===planIdea.dataset.planIdea);const slot=freeTogether(14)[0];state.prefillDay=slot?wallInput(new Date(slot.start)):undefined;openForm('event');const form=document.querySelector<HTMLFormElement>('#item-form')!;(form.elements.namedItem('title') as HTMLInputElement).value=idea?.title||'';const person=form.elements.namedItem('person') as HTMLSelectElement|null;if(person)person.value='';return;}
    const planSlot=target.closest<HTMLElement>('[data-plan-slot]');if(planSlot){state.prefillDay=planSlot.dataset.planSlot;openForm('event');const person=document.querySelector<HTMLSelectElement>('#item-form select[name="person"]');if(person)person.value='';return;}
    const onDay=target.closest<HTMLElement>('[data-create-on-day]');if(onDay){state.prefillDay=onDay.dataset.createOnDay;openForm('event');}
  });
  document.addEventListener('submit',async event=>{const target=event.target as HTMLElement;if(target.matches('[data-list-item-form]'))await addListItem(event as SubmitEvent);});
  $('#add-button').addEventListener('click',()=>{if(window.matchMedia('(max-width: 780px)').matches)openForm('task');else dialog('#add-dialog').showModal();});
  $('#invite-button').addEventListener('click',()=>{($('#invite-form') as HTMLFormElement).reset();$('#invite-result').hidden=true;dialog('#invite-dialog').showModal();});
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog')?.close()));
  document.querySelectorAll<HTMLElement>('[data-create]').forEach(()=>{});
  $('#item-form').addEventListener('submit',saveItem);
  $('#list-form').addEventListener('submit',createList);
  $('#idea-form').addEventListener('submit',saveIdea);
  $('#shift-form').addEventListener('submit',saveShift);
  $('#delete-shift').addEventListener('click',deleteShift);
  document.addEventListener('input',event=>{if((event.target as HTMLElement).closest('[data-pay-calc]'))updatePayCalc();});
  document.addEventListener('submit',event=>{if((event.target as HTMLElement).matches('[data-pay-calc]'))event.preventDefault();});
  $('#delete-item').addEventListener('click',deleteCurrentItem);
  $('#install-button').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();const choice=await installPrompt.userChoice;installPrompt=null;if(choice?.outcome==='accepted')$('#install-button').hidden=true;}else dialog('#install-dialog').showModal();});
  $('#account-button').addEventListener('click',()=>{if(!state.user)return;($('#profile-name') as HTMLInputElement).value=memberLabel(state.user.id);dialog('#profile-dialog').showModal();});
  $('#profile-form').addEventListener('submit',saveProfile);
  $('#feed-button').addEventListener('click',createCalendarFeed);
  $('#copy-feed').addEventListener('click',async()=>{const link=$('#feed-link') as HTMLInputElement;try{await navigator.clipboard.writeText(link.value);notify('Calendar link copied.');}catch{link.focus();link.select();notify('Select and copy the calendar link.');}});
  $('#sign-out-button').addEventListener('click',async()=>{if(!supabase)return;dialog('#profile-dialog').close();await supabase.auth.signOut();state.user=null;state.space=null;openAuth();});
  $('#auth-toggle').addEventListener('click',()=>{if(!pendingInvite)return;const title=$('#auth-title');const button=$('#auth-submit');const signup=button.textContent==='Sign in';title.textContent=signup?'Create your account':'You’ve been invited';button.textContent=signup?'Create account':'Sign in';$('#auth-toggle').textContent=signup?'Already have an account? Sign in':'New here? Create an account';});
  $('#auth-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase)return;const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);const email=formValue(data,'email');const password=formValue(data,'password');const signup=$('#auth-submit').textContent==='Create account';if(signup&&!pendingInvite){notify('Use your partner’s invite link to create an account.',true);return;}const redirect=new URL(window.location.pathname,window.location.origin);if(pendingInvite)redirect.searchParams.set('invite',pendingInvite);const result=signup?await supabase.auth.signUp({email,password,options:{emailRedirectTo:redirect.toString(),data:{sidequest_invite_token:pendingInvite}}}):await supabase.auth.signInWithPassword({email,password});if(result.error){notify(result.error.message,true);return;}if(signup&&!result.data.session){dialog('#auth-dialog').close();notify('Check your email to confirm your account, then open the invite link again.');return;}dialog('#auth-dialog').close();await handleAuthenticatedUser(result.data.user);});
  $('#space-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase||!state.user)return;const form=event.currentTarget as HTMLFormElement;const name=formValue(new FormData(form),'name')||'Our space';const {error}=await supabase.from('spaces').insert({name,owner_id:state.user.id,timezone:TZ});if(error){notify(error.message,true);return;}dialog('#space-dialog').close();notify('Your space is ready.');await refresh();});
  $('#invite-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase||!state.space)return;const form=event.currentTarget as HTMLFormElement;const email=formValue(new FormData(form),'email');const button=$('#invite-submit') as HTMLButtonElement;button.disabled=true;button.textContent='Creating link…';const {data,error}=await supabase.rpc('create_space_invitation',{p_space_id:state.space.id,p_invited_email:email});button.disabled=false;button.textContent='Create invite link';if(error){notify(error.message,true);return;}const link=new URL(window.location.pathname,window.location.origin);link.searchParams.set('invite',String(data));$('#invite-link').setAttribute('value',link.toString());$('#invite-result').hidden=false;notify('Your one-use invite link is ready.');});
  $('#copy-invite').addEventListener('click',async()=>{const link=$('#invite-link') as HTMLInputElement;try{await navigator.clipboard.writeText(link.value);notify('Invite link copied.');}catch{link.focus();link.select();notify('Select and copy the invite link.');}});
}
async function init() {
  state.calendarMode=localGet('sidequest:calendar-mode')==='month'?'month':'week';state.showTasks=localGet('sidequest:calendar-tasks')!=='0';state.taskPerson=localGet('sidequest:task-person')||'all';
  bindEvents();setView(pendingView&&views.includes(pendingView)?pendingView:'today');
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.space&&Date.now()-lastRefresh>30000)void refresh();});
  window.addEventListener('online',()=>{void flushTaskOutbox();});
  window.addEventListener('offline',()=>{state.offline=true;updateOfflineStatus();});
  const installButton=$('#install-button') as HTMLButtonElement;
  const isInstalled=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true;
  installButton.hidden=isInstalled;
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;installButton.hidden=false;});
  window.addEventListener('appinstalled',()=>{installButton.hidden=true;installPrompt=null;notify('Sidequest is on your home screen.');});
  dialog('#auth-dialog').addEventListener('cancel',event=>{if(!state.user)event.preventDefault();});
  dialog('#space-dialog').addEventListener('cancel',event=>{if(state.user&&!state.space)event.preventDefault();});
  if(!configured){$('#app').hidden=true;document.body.insertAdjacentHTML('beforeend',`<div class="auth-screen"><a class="brand auth-brand"><span class="brand-mark">s</span><span>sidequest</span></a><div class="dialog-card"><p class="eyebrow">A little space for two</p><h1>Your life, on the same page.</h1><p class="muted">Sidequest is ready to connect to your shared planner. Add the Supabase URL and publishable key to <code>.env.local</code> to get started.</p><p class="auth-footer">Your Supabase project is configured through environment variables. Never put a service role key here.</p></div></div>`);return;}
  if(pendingInvite){$('#auth-title').textContent='You’ve been invited';$('#auth-description').textContent='Use the invited email address to sign in or create your account and join your shared space.';}else{$('#auth-toggle').hidden=true;$('#auth-description').textContent='Sign in to open your private shared planner. New accounts require a partner invite.';}
  supabase!.auth.onAuthStateChange((_event,session)=>{void handleAuthenticatedUser(session?.user||null);});
  const {data:{session},error:sessionError}=await supabase!.auth.getSession();
  if(sessionError)notify('Could not restore your saved sign-in. Please sign in again.',true);
  state.user=session?.user||null;
  if(state.user) await handleAuthenticatedUser(state.user); else openAuth();
}
void init();
