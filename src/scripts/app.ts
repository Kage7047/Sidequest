import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, any>;
type Kind = 'task' | 'event' | 'project' | 'goal';
const TZ = 'Europe/Warsaw';
let pendingInvite = new URLSearchParams(window.location.search).get('invite');
let handledUserId: string | null = null;
let acceptingInvite = false;
const configured = Boolean(import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const supabase: SupabaseClient | null = configured ? createClient(import.meta.env.PUBLIC_SUPABASE_URL, import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) : null;
const state: { user: any; space: Row | null; events: Row[]; tasks: Row[]; projects: Row[]; goals: Row[]; view: string; calendarOffset: number; taskFilter: string; planTab: string; editing?: Row } = {
  user: null, space: null, events: [], tasks: [], projects: [], goals: [], view: 'today', calendarOffset: 0, taskFilter: 'open', planTab: 'projects',
};
const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
const dialog = (selector: string) => $(selector) as HTMLDialogElement;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const timeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
const longDateFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const partsInWarsaw = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
function wallToIso(value: string) {
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
function wallInput(date: Date) { const p = partsInWarsaw(date); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
function dateOnlyInput(iso?: string | null) { return iso ? dateKey(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : ''; }
function asDay(iso: string) { return dateKey(new Date(iso)); }
function todayAtNoon() { const now = new Date(); return new Date(`${dateKey(now)}T12:00:00Z`); }
function daysFrom(base: Date, amount: number) { const date = new Date(base); date.setUTCDate(date.getUTCDate() + amount); return date; }
function greeting() { const hour = Number(partsInWarsaw(new Date()).hour); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
function notify(message: string, error = false) { const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.classList.add('show'); window.setTimeout(() => node.classList.remove('show'), 3200); }
function loading(message: string) { document.querySelectorAll('.view').forEach(view => view.innerHTML = `<div class="loading-state">${escapeHtml(message)}</div>`); }
function empty(title: string, message: string, icon = '✳') { return `<div class="empty-state"><div class="empty-mark">${icon}</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`; }
function itemDate(iso: string | null | undefined) { return iso ? dateFormatter.format(new Date(iso)) : ''; }
function itemTime(iso: string | null | undefined) { return iso ? timeFormatter.format(new Date(iso)) : ''; }
function shortDate(iso: string | null | undefined) { return iso ? new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)) : ''; }
function heading(title: string, subtitle = '') { return `<header class="page-heading"><p class="eyebrow">Your life, on the same page</p><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</header>`; }
function sectionTitle(title: string, count: number, action = '') { return `<div class="section-heading"><h2>${title}</h2><span class="count">${count || ' '}</span>${action}</div>`; }
function dueLabel(iso: string | null | undefined) { if (!iso) return 'No due date'; const day = asDay(iso); const today = dateKey(new Date()); return day < today ? `Overdue · ${itemDate(iso)}` : day === today ? 'Due today' : itemDate(iso); }
function eventRow(event: Row, fullDate = false) { return `<div class="row-item"><div class="event-time">${event.all_day ? 'All day' : itemTime(event.starts_at)}</div><div class="row-content"><div class="row-title">${escapeHtml(event.title)}</div><div class="row-meta">${fullDate ? `${itemDate(event.starts_at)} · ` : ''}${escapeHtml(event.location || (event.all_day ? 'All day' : ''))}</div></div><span class="tag ${event.visibility === 'personal' ? 'personal' : ''}">${event.visibility === 'personal' ? 'Just me' : 'Together'}</span><button class="icon-button" data-edit="event" data-id="${event.id}" aria-label="Edit ${escapeHtml(event.title)}">···</button></div>`; }
function taskRow(task: Row) { return `<div class="row-item"><button class="check-action" data-toggle-task="${task.id}" aria-label="${task.completed ? 'Reopen' : 'Complete'} ${escapeHtml(task.title)}"><span class="checkbox ${task.completed ? 'done' : ''}">${task.completed ? '✓' : ''}</span></button><div class="row-content"><div class="row-title" ${task.completed ? 'style="text-decoration:line-through;color:#929387"' : ''}>${escapeHtml(task.title)}</div><div class="row-meta"><span class="priority-dot ${task.priority === 'high' ? 'high' : task.priority === 'low' ? 'low' : ''}"></span>${escapeHtml(task.priority)} priority · ${escapeHtml(dueLabel(task.due_at))}</div></div><button class="icon-button" data-edit="task" data-id="${task.id}" aria-label="Edit ${escapeHtml(task.title)}">···</button></div>`; }
function projectCard(project: Row) { return `<article class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(project.title)}</span><span class="tag ${project.status === 'done' ? 'done' : ''}">${escapeHtml(project.status)}</span></div>${project.description ? `<div class="row-meta">${escapeHtml(project.description)}</div>` : ''}<div class="plan-meta">${project.start_date ? shortDate(project.start_date) : 'No start date'}${project.target_date ? ` → ${shortDate(project.target_date)}` : ''}</div><div class="tile-actions" style="margin-top:8px"><button class="text-button" data-edit="project" data-id="${project.id}">Edit project</button></div></article>`; }
function goalCard(goal: Row) { return `<article class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(goal.title)}</span><span class="plan-meta">${goal.progress}%</span></div>${goal.description ? `<div class="row-meta">${escapeHtml(goal.description)}</div>` : ''}<div class="progress-track"><span style="width:${Math.max(0, Math.min(100, Number(goal.progress)))}%"></span></div><div class="tile-footer"><span>${goal.target_date ? `Target · ${shortDate(goal.target_date)}` : 'No target date'}</span><button class="text-button" data-edit="goal" data-id="${goal.id}">Edit goal</button></div></article>`; }
function renderToday() {
  const todayKey = dateKey(new Date()); const now = Date.now(); const todayEvents = state.events.filter(e => asDay(e.starts_at) === todayKey && (e.all_day || new Date(e.starts_at).getTime() >= now)).sort((a,b) => a.starts_at.localeCompare(b.starts_at));
  const tasks = state.tasks.filter(t => !t.completed && (!t.due_at || asDay(t.due_at) <= todayKey)).sort((a,b) => (a.due_at || '').localeCompare(b.due_at || ''));
  const upcomingProjects = state.projects.filter(p => p.status === 'active').slice(0,3); const openGoals = state.goals.filter(g => g.progress < 100).slice(0,3);
  $('#view-today').innerHTML = `${heading(`${greeting()}, ${escapeHtml(state.user?.user_metadata?.first_name || state.user?.email?.split('@')[0] || 'you')}.`, longDateFormatter.format(new Date()))}<div class="today-grid"><div class="stack"><section>${sectionTitle('Today’s events', todayEvents.length, '<button class="inline-add" data-create="event">+ Add event</button>')}<div class="surface">${todayEvents.length ? `<div class="list">${todayEvents.map(e=>eventRow(e)).join('')}</div>` : empty('Nothing on the calendar yet', 'A little room to breathe. Add something you’re looking forward to.', '☼')}</div></section><section>${sectionTitle('Tasks to take care of', tasks.length, '<button class="inline-add" data-create="task">+ Add task</button>')}<div class="surface">${tasks.length ? `<div class="list">${tasks.map(taskRow).join('')}</div>` : empty('You’re all caught up', 'Add a task when something comes to mind.', '✓')}</div></section></div><div class="stack"><section>${sectionTitle('In motion', upcomingProjects.length)}<div class="surface soft">${upcomingProjects.length ? upcomingProjects.map(p => `<div class="plan-card"><div class="plan-title">${escapeHtml(p.title)}</div><div class="plan-meta">${p.target_date ? `Until ${shortDate(p.target_date)}` : 'Project'}</div></div>`).join('') : empty('Projects will live here', 'Start a shared project when you’re ready.', '↗')}</div></section><section>${sectionTitle('Growing toward', openGoals.length)}<div class="surface">${openGoals.length ? openGoals.map(g => `<div class="plan-card"><div class="plan-card-top"><span class="plan-title">${escapeHtml(g.title)}</span><span class="plan-meta">${g.progress}%</span></div><div class="progress-track"><span style="width:${g.progress}%"></span></div></div>`).join('') : empty('Your goals, at your pace', 'A small step counts too.', '◎')}</div></section><section class="surface soft"><div class="section-heading"><h2>A small reminder</h2><span class="sidebar-sparkle">✳</span></div><p class="muted" style="margin:0">You don’t have to figure everything out today. Just keep choosing the next kind thing.</p></section></div></div>`;
}
function renderCalendar() {
  const now = todayAtNoon(); const day = daysFrom(now, state.calendarOffset * 7); const mondayOffset = (day.getUTCDay() + 6) % 7; const start = daysFrom(day, -mondayOffset); const end = daysFrom(start, 7);
  const days = Array.from({length:7}, (_, i) => daysFrom(start, i));
  const shown = state.events.filter(e => { const key = asDay(e.starts_at); return key >= dateKey(start) && key < dateKey(end); }).sort((a,b) => a.starts_at.localeCompare(b.starts_at));
  const label = `${new Intl.DateTimeFormat('en-GB',{month:'short',day:'numeric',timeZone:'UTC'}).format(start)} – ${new Intl.DateTimeFormat('en-GB',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(daysFrom(end,-1))}`;
  $('#view-calendar').innerHTML = `${heading('Calendar', 'A simple look at the time you’re making for each other.')}<div class="toolbar"><div class="segmented"><button class="selected">Week</button><button data-calendar-day="today">Today</button></div><div class="date-nav"><button data-calendar-step="-1" aria-label="Previous week">‹</button><span class="date-label">${label}</span><button data-calendar-step="1" aria-label="Next week">›</button></div><button class="button secondary small" data-create="event">+ New event</button></div><div class="surface"><div class="list">${days.map(date => {const key=dateKey(date);const dayEvents=shown.filter(e=>asDay(e.starts_at)===key);return `<section class="agenda-day"><p class="agenda-day-label">${new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'}).format(date)}${key===dateKey(new Date())?' · Today':''}</p>${dayEvents.length?dayEvents.map(e=>`<div class="agenda-event"><div class="event-time">${e.all_day?'All day':itemTime(e.starts_at)}</div><div class="row-content"><div class="row-title">${escapeHtml(e.title)}</div><div class="row-meta">${escapeHtml(e.location||'')}</div></div><span class="tag ${e.visibility==='personal'?'personal':''}">${e.visibility==='personal'?'Just me':'Together'}</span><button class="icon-button" data-edit="event" data-id="${e.id}" aria-label="Edit ${escapeHtml(e.title)}">···</button></div>`).join(''):empty('A little open space','No events planned for this day.','·')}</section>`;}).join('')}</div></div>`;
}
function renderTasks() {
  const filters=[['open','To do'],['completed','Done'],['all','Everything']]; const list=state.tasks.filter(t=>state.taskFilter==='all'||(state.taskFilter==='completed'?t.completed:!t.completed)).sort((a,b)=>Number(a.completed)-Number(b.completed)||(a.due_at||'').localeCompare(b.due_at||''));
  $('#view-tasks').innerHTML=`${heading('Tasks', 'The little things that make the bigger things happen.')}<div class="toolbar"><div class="filters">${filters.map(([value,label])=>`<button class="filter-chip ${state.taskFilter===value?'selected':''}" data-task-filter="${value}">${label}${value==='open'?` · ${state.tasks.filter(t=>!t.completed).length}`:''}</button>`).join('')}</div><button class="button primary small" data-create="task">+ Add task</button></div><div class="surface">${list.length?`<div class="list">${list.map(taskRow).join('')}</div>`:empty(state.taskFilter==='completed'?'Nothing completed just yet':'Your list is clear','Add a task and take it one step at a time.','✓')}</div>`;
}
function renderPlans() {
  const isProjects=state.planTab==='projects'; const records=isProjects?state.projects:state.goals;
  $('#view-plans').innerHTML=`${heading('Our plans', 'The things you’re building and the places you hope to go.')}<div class="toolbar"><div class="plan-tabs"><button class="${isProjects?'selected':''}" data-plan-tab="projects">Projects <span class="count">${state.projects.length}</span></button><button class="${!isProjects?'selected':''}" data-plan-tab="goals">Goals <span class="count">${state.goals.length}</span></button></div><button class="button primary small" data-create="${isProjects?'project':'goal'}">+ Add ${isProjects?'project':'goal'}</button></div><div class="plan-grid">${records.length?records.map(isProjects?projectCard:goalCard).join(''):empty(isProjects?'A project starts with an idea':'Give a hope somewhere to grow',isProjects?'Plan something you’d like to do together.':'Choose a goal you can work toward together.',isProjects?'↗':'◎')}</div>`;
}
function render() { renderToday(); renderCalendar(); renderTasks(); renderPlans(); }
async function refresh() {
  if (!supabase || !state.user) return;
  loading('Opening your space…');
  const { data: space, error: spaceError } = await supabase.from('spaces').select('id,name,timezone,owner_id').limit(1).maybeSingle();
  if (spaceError) { notify(spaceError.message, true); return; }
  state.space = space;
  $('#space-name').textContent = space?.name || 'Our space';
  if (space) {
    const { data: members, error: membersError } = await supabase.from('space_members').select('user_id').eq('space_id', space.id);
    if (membersError) { notify(membersError.message, true); return; }
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
  if(failure){notify(failure.message,true);return;}
  state.events=events.data||[];state.tasks=tasks.data||[];state.projects=projects.data||[];state.goals=goals.data||[];render();
}
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
    state.space = null; state.events = []; state.tasks = []; state.projects = []; state.goals = [];
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
    notify('You’ve joined your shared space.');
  }
  await refresh();
}
function input(name:string,label:string,type='text',value='',options:Record<string,string>={}) { const attrs=Object.entries(options).map(([key,val])=>`${key}="${escapeHtml(val)}"`).join(' '); return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs} /></label>`; }
function textarea(name:string,label:string,value='') { return `<label class="wide">${label}<textarea name="${name}" maxlength="1000">${escapeHtml(value)}</textarea></label>`; }
function select(name:string,label:string,options:Array<[string,string]>,value:string) { return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select></label>`; }
function dateInput(name:string,label:string,value?:string|null) { return input(name,label,'date',value?dateOnlyInput(value):''); }
function openForm(kind:Kind, record?:Row) {
  if(!state.space){notify('Create your space before adding plans.',true);return;}
  state.editing=record; const form=$('#form-fields'); const title=$('#form-title'); $('#form-kind').textContent=`${record?'Edit':'New'} ${kind}`; title.textContent=record?`Edit ${kind}`:`Add a ${kind}`;
    if(kind==='task') form.innerHTML=`<div class="form-grid">${input('title','What needs doing?','text',record?.title||'',{required:'required',maxlength:'200',placeholder:'e.g. Book a table'})}${select('priority','Priority',[['low','Low'],['normal','Normal'],['high','High']],record?.priority||'normal')}${input('due_at','Due date and time','datetime-local',record?.due_at?wallInput(new Date(record.due_at)):wallInput(new Date(Date.now()+3600000)),{class:'wide'})}${select('project_id','Project',[['','No project'],...state.projects.map(p=>[p.id,p.title] as [string,string])],record?.project_id||'')}${textarea('description','A few details',record?.description||'')}</div>`;
  if(kind==='event') form.innerHTML=`<div class="form-grid">${input('title','What’s happening?','text',record?.title||'',{required:'required',maxlength:'200',placeholder:'e.g. Dinner with friends'})}${select('visibility','Who can see this?',[['shared','Together'],['personal','Just me']],record?.visibility||'shared')}<label><span>All-day event</span><input name="all_day" type="checkbox" ${record?.all_day?'checked':''} style="width:18px;height:18px;accent-color:#82917A" /></label>${input('starts_at','Starts','datetime-local',record?.starts_at?(record?.all_day?dateOnlyInput(record.starts_at):wallInput(new Date(record.starts_at))):wallInput(new Date(Date.now()+3600000)),{required:'required'})}${input('ends_at','Ends (optional)','datetime-local',record?.ends_at?(record?.all_day?dateOnlyInput(record.ends_at):wallInput(new Date(record.ends_at))):'')}${input('location','Where?','text',record?.location||'',{maxlength:'200',placeholder:'Optional'})}${textarea('description','A few details',record?.description||'')}</div>`;
  if(kind==='project') form.innerHTML=`<div class="form-grid">${input('title','Project name','text',record?.title||'',{required:'required',maxlength:'160',placeholder:'e.g. Plan a weekend away'})}${select('status','Status',[['planned','Planned'],['active','Active'],['done','Done']],record?.status||'planned')}${dateInput('start_date','Start date',record?.start_date)}${dateInput('target_date','Target date',record?.target_date)}${textarea('description','A few details',record?.description||'')}</div>`;
  if(kind==='goal') form.innerHTML=`<div class="form-grid">${input('title','Goal','text',record?.title||'',{required:'required',maxlength:'160',placeholder:'e.g. Take a trip somewhere new'})}${input('progress','Progress (%)','number',String(record?.progress??0),{min:'0',max:'100',step:'1',required:'required'})}${dateInput('target_date','Target date',record?.target_date)}${textarea('description','A few details',record?.description||'')}</div>`;
  const allDay=form.querySelector<HTMLInputElement>('[name="all_day"]');
  allDay?.addEventListener('change',()=>{for(const name of ['starts_at','ends_at']){const field=form.querySelector<HTMLInputElement>(`[name="${name}"]`);if(!field)continue;const date=field.value.split('T')[0];field.type=allDay.checked?'date':'datetime-local';field.value=allDay.checked?date:(date?`${date}T09:00`:wallInput(new Date()));}});
  $('#save-item').textContent=record?'Save changes':'Save'; dialog('#item-dialog').showModal();
}
function formValue(data:FormData,key:string) { return String(data.get(key)||'').trim(); }
async function saveItem(event:SubmitEvent) {
  event.preventDefault(); if(!supabase||!state.user||!state.space)return;
  const form=event.currentTarget as HTMLFormElement; const data=new FormData(form);const kind=$('#form-kind').textContent?.replace(/^(New|Edit) /,'') as Kind;const record=state.editing;const payload:Row={space_id:state.space.id};
  const title=formValue(data,'title');if(!title){notify('Add a title before saving.',true);return;}
  payload.title=title;payload.created_by=state.user.id;
  if(kind==='task'){payload.description=formValue(data,'description')||null;payload.priority=formValue(data,'priority');payload.project_id=formValue(data,'project_id')||null;const due=formValue(data,'due_at');payload.due_at=due?wallToIso(due):null;payload.completed=record?.completed??false;}
  if(kind==='event'){payload.description=formValue(data,'description')||null;payload.location=formValue(data,'location')||null;payload.visibility=formValue(data,'visibility');const allDay=data.get('all_day')==='on';const start=formValue(data,'starts_at');const end=formValue(data,'ends_at');payload.starts_at=wallToIso(allDay?`${start}T00:00`:start);payload.ends_at=end?wallToIso(allDay?`${end}T00:00`:end):null;payload.all_day=allDay;if(payload.ends_at&&payload.ends_at<payload.starts_at){notify('The end time needs to be after the start time.',true);return;}}
  if(kind==='project'){payload.description=formValue(data,'description')||null;payload.status=formValue(data,'status');payload.start_date=formValue(data,'start_date')||null;payload.target_date=formValue(data,'target_date')||null;if(payload.start_date&&payload.target_date&&payload.target_date<payload.start_date){notify('The target date must be after the start date.',true);return;}}
  if(kind==='goal'){payload.description=formValue(data,'description')||null;payload.target_date=formValue(data,'target_date')||null;payload.progress=Number(formValue(data,'progress'));if(!Number.isInteger(payload.progress)||payload.progress<0||payload.progress>100){notify('Progress must be a whole number from 0 to 100.',true);return;}}
  const table=kind==='task'?'tasks':kind==='event'?'events':kind==='project'?'projects':'goals';let result;
  if(record) { delete payload.created_by; delete payload.space_id;result=await supabase.from(table).update(payload).eq('id',record.id).eq('space_id',state.space.id).select('id').maybeSingle(); }
  else result=await supabase.from(table).insert(payload).select('id').maybeSingle();
  if(result.error){notify(result.error.message,true);return;}if(record&&!result.data){notify('This item could not be updated. Check your space access.',true);return;}
  dialog('#item-dialog').close();form.reset();notify(record?'Changes saved.':`${kind[0].toUpperCase()+kind.slice(1)} added.`);await refresh();
}
async function toggleTask(id:string) { if(!supabase)return;const task=state.tasks.find(t=>t.id===id);if(!task)return;const {data,error}=await supabase.from('tasks').update({completed:!task.completed}).eq('id',id).eq('space_id',state.space?.id).select('id').maybeSingle();if(error){notify(error.message,true);return;}if(!data){notify('This task could not be changed. Check your space access.',true);return;}await refresh(); }
function bindEvents() {
  document.addEventListener('click',async event=>{const target=event.target as HTMLElement;const view=target.closest<HTMLElement>('[data-view]');if(view){setView(view.dataset.view!);return;}
    const create=target.closest<HTMLElement>('[data-create]');if(create){dialog('#add-dialog').close();openForm(create.dataset.create as Kind);return;}
    const edit=target.closest<HTMLElement>('[data-edit]');if(edit){const kind=edit.dataset.edit as Kind;const row=({task:state.tasks,event:state.events,project:state.projects,goal:state.goals}[kind]).find(i=>i.id===edit.dataset.id);if(row)openForm(kind,row);return;}
    const toggle=target.closest<HTMLElement>('[data-toggle-task]');if(toggle){await toggleTask(toggle.dataset.toggleTask!);return;}
    const filter=target.closest<HTMLElement>('[data-task-filter]');if(filter){state.taskFilter=filter.dataset.taskFilter!;renderTasks();return;}
    const tab=target.closest<HTMLElement>('[data-plan-tab]');if(tab){state.planTab=tab.dataset.planTab!;renderPlans();return;}
    const step=target.closest<HTMLElement>('[data-calendar-step]');if(step){state.calendarOffset+=Number(step.dataset.calendarStep);renderCalendar();return;}
    if(target.closest('[data-calendar-day]')){state.calendarOffset=0;renderCalendar();}
  });
  $('#add-button').addEventListener('click',()=>dialog('#add-dialog').showModal());
  $('#invite-button').addEventListener('click',()=>{($('#invite-form') as HTMLFormElement).reset();$('#invite-result').hidden=true;dialog('#invite-dialog').showModal();});
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>button.closest('dialog')?.close()));
  document.querySelectorAll<HTMLElement>('[data-create]').forEach(()=>{});
  $('#item-form').addEventListener('submit',saveItem);
  $('#account-button').addEventListener('click',async()=>{if(!supabase)return;await supabase.auth.signOut();state.user=null;state.space=null;openAuth();});
  $('#auth-toggle').addEventListener('click',()=>{const title=$('#auth-title');const button=$('#auth-submit');const signup=button.textContent==='Sign in';title.textContent=signup?'Create your account':'Welcome to Sidequest';button.textContent=signup?'Create account':'Sign in';$('#auth-toggle').textContent=signup?'Already have an account? Sign in':'New here? Create an account';});
  $('#auth-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase)return;const form=event.currentTarget as HTMLFormElement;const data=new FormData(form);const email=formValue(data,'email');const password=formValue(data,'password');const signup=$('#auth-submit').textContent==='Create account';const redirect=new URL(window.location.pathname,window.location.origin);if(pendingInvite)redirect.searchParams.set('invite',pendingInvite);const result=signup?await supabase.auth.signUp({email,password,options:{emailRedirectTo:redirect.toString()}}):await supabase.auth.signInWithPassword({email,password});if(result.error){notify(result.error.message,true);return;}if(signup&&!result.data.session){dialog('#auth-dialog').close();notify('Check your email to confirm your account, then open the invite link again.');return;}dialog('#auth-dialog').close();await handleAuthenticatedUser(result.data.user);});
  $('#space-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase||!state.user)return;const form=event.currentTarget as HTMLFormElement;const name=formValue(new FormData(form),'name')||'Our space';const {error}=await supabase.from('spaces').insert({name,owner_id:state.user.id,timezone:TZ});if(error){notify(error.message,true);return;}dialog('#space-dialog').close();notify('Your space is ready.');await refresh();});
  $('#invite-form').addEventListener('submit',async event=>{event.preventDefault();if(!supabase||!state.space)return;const form=event.currentTarget as HTMLFormElement;const email=formValue(new FormData(form),'email');const button=$('#invite-submit') as HTMLButtonElement;button.disabled=true;button.textContent='Creating link…';const {data,error}=await supabase.rpc('create_space_invitation',{p_space_id:state.space.id,p_invited_email:email});button.disabled=false;button.textContent='Create invite link';if(error){notify(error.message,true);return;}const link=new URL(window.location.pathname,window.location.origin);link.searchParams.set('invite',String(data));$('#invite-link').setAttribute('value',link.toString());$('#invite-result').hidden=false;notify('Your one-use invite link is ready.');});
  $('#copy-invite').addEventListener('click',async()=>{const link=$('#invite-link') as HTMLInputElement;try{await navigator.clipboard.writeText(link.value);notify('Invite link copied.');}catch{link.focus();link.select();notify('Select and copy the invite link.');}});
}
async function init() {
  bindEvents();setView('today');
  dialog('#auth-dialog').addEventListener('cancel',event=>{if(!state.user)event.preventDefault();});
  dialog('#space-dialog').addEventListener('cancel',event=>{if(state.user&&!state.space)event.preventDefault();});
  if(!configured){$('#app').hidden=true;document.body.insertAdjacentHTML('beforeend',`<div class="auth-screen"><a class="brand auth-brand"><span class="brand-mark">s</span><span>sidequest</span></a><div class="dialog-card"><p class="eyebrow">A little space for two</p><h1>Your life, on the same page.</h1><p class="muted">Sidequest is ready to connect to your shared planner. Add the Supabase URL and publishable key to <code>.env.local</code> to get started.</p><p class="auth-footer">Your Supabase project is configured through environment variables. Never put a service role key here.</p></div></div>`);return;}
  if(pendingInvite){$('#auth-title').textContent='You’ve been invited';$('#auth-description').textContent='Use the invited email address to sign in or create your account and join your shared space.';}
  supabase!.auth.onAuthStateChange((_event,session)=>{void handleAuthenticatedUser(session?.user||null);});
  state.user=(await supabase!.auth.getUser()).data.user;
  if(state.user) await handleAuthenticatedUser(state.user); else openAuth();
}
void init();
