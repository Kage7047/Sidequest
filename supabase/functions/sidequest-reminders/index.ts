import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': 'https://kage7047.github.io',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

type Task = { id: string; space_id: string; title: string; assigned_to: string | null };
type Subscription = { id: string; user_id: string; endpoint: string; subscription: webpush.PushSubscription };

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed' }, 405);
  let body: { action?: string };
  try { body = await request.json(); } catch { return respond({ error: 'Invalid request' }, 400); }

  const { data: config, error: configError } = await supabase.from('push_config').select('*').eq('id', true).maybeSingle();
  if (configError || !config) return respond({ error: 'Reminder service is not configured' }, 503);
  if (body.action === 'public-key') return respond({ publicKey: config.vapid_public_key });
  if (body.action !== 'dispatch' || request.headers.get('x-cron-secret') !== config.cron_secret) return respond({ error: 'Unauthorized' }, 401);

  webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);
  const { data: tasks, error: claimError } = await supabase.rpc('claim_due_reminders', { p_limit: 100 });
  if (claimError) return respond({ error: 'Could not claim reminders' }, 500);
  let sent = 0;
  let retried = 0;
  for (const task of (tasks || []) as Task[]) {
    const { data: members, error: memberError } = await supabase.from('space_members').select('user_id').eq('space_id', task.space_id);
    if (memberError) {
      await supabase.from('tasks').update({ reminder_claimed_at: null }).eq('id', task.id);
      retried++;
      continue;
    }
    const recipients = task.assigned_to ? [task.assigned_to] : (members || []).map((member: { user_id: string }) => member.user_id);
    const { data: subscriptions, error: subscriptionError } = recipients.length
      ? await supabase.from('push_subscriptions').select('id,user_id,endpoint,subscription').in('user_id', recipients)
      : { data: [], error: null };
    if (subscriptionError) {
      await supabase.from('tasks').update({ reminder_claimed_at: null }).eq('id', task.id);
      retried++;
      continue;
    }
    let shouldRetry = false;
    for (const saved of (subscriptions || []) as Subscription[]) {
      try {
        await webpush.sendNotification(saved.subscription, JSON.stringify({ title: 'Sidequest reminder', body: task.title, tag: `task-${task.id}`, url: '/Sidequest/?view=tasks' }));
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', saved.id);
        } else if (status >= 500 || status === 0) {
          shouldRetry = true;
        }
      }
    }
    if (shouldRetry) {
      await supabase.from('tasks').update({ reminder_claimed_at: null }).eq('id', task.id);
      retried++;
    } else {
      await supabase.from('tasks').update({ reminder_sent_at: new Date().toISOString(), reminder_claimed_at: null }).eq('id', task.id);
      sent++;
    }
  }
  // Event reminders: one push per occurrence to whoever the event is for.
  const { data: events, error: eventError } = await supabase.rpc('claim_due_event_reminders', { p_limit: 100 });
  if (eventError) return respond({ sent, retried, error: 'Could not claim event reminders' }, 500);
  const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (const event of (events || []) as Array<{ id: string; title: string; occurs_at: string; recipients: string[] }>) {
    if (!event.recipients?.length) continue;
    const { data: subscriptions } = await supabase.from('push_subscriptions').select('id,user_id,endpoint,subscription').in('user_id', event.recipients);
    let shouldRetry = false;
    for (const saved of (subscriptions || []) as Subscription[]) {
      try {
        await webpush.sendNotification(saved.subscription, JSON.stringify({ title: event.title, body: `Starts ${timeFormat.format(new Date(event.occurs_at))}`, tag: `event-${event.id}-${event.occurs_at}`, url: '/Sidequest/?view=calendar' }));
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) await supabase.from('push_subscriptions').delete().eq('id', saved.id);
        else if (status >= 500 || status === 0) shouldRetry = true;
      }
    }
    if (shouldRetry) { await supabase.from('event_reminder_log').delete().eq('event_id', event.id).eq('occurs_at', event.occurs_at); retried++; }
    else sent++;
  }
  // Morning summary and "your partner gave you…" pushes. Sent once; a failed push is not retried.
  const { data: digests } = await supabase.rpc('claim_morning_digests');
  const { data: partner } = await supabase.rpc('claim_partner_notifications', { p_limit: 100 });
  const simple = [
    ...((digests || []) as Array<{ user_id: string; body: string }>).map(d => ({ user_id: d.user_id, title: 'Today', body: d.body, url: '/Sidequest/', tag: 'morning' })),
    ...((partner || []) as Array<{ user_id: string; title: string; body: string; url: string }>).map(n => ({ ...n, tag: `partner-${Date.now()}-${Math.random()}` })),
  ];
  for (const message of simple) {
    const { data: subscriptions } = await supabase.from('push_subscriptions').select('id,user_id,endpoint,subscription').eq('user_id', message.user_id);
    for (const saved of (subscriptions || []) as Subscription[]) {
      try {
        await webpush.sendNotification(saved.subscription, JSON.stringify({ title: message.title, body: message.body, tag: message.tag, url: message.url }));
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode || 0);
        if (status === 404 || status === 410) await supabase.from('push_subscriptions').delete().eq('id', saved.id);
      }
    }
    sent++;
  }
  return respond({ sent, retried });
});
