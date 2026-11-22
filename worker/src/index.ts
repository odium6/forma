import { buildPushHTTPRequest } from '@pushforge/builder';
import { z } from 'zod';
import { reminderSchema } from '../../src/lib/backup/schema';
import { applySnooze, dueDeliveries, EMPTY_STATE, wakeDelivery, wallClock, wallDate, type SubConfig, type SubState } from './schedule';

/**
 * FORMA push Worker (Cloudflare Workers Free + D1).
 * Stores only: push endpoint + keys, time zone, reminder schedule/labels, quiet hours,
 * and "already done today" flags. No weights, photos or other health data.
 */

interface Env {
  DB: D1Database;
  VAPID_PRIVATE_JWK: string;
  ALLOWED_ORIGINS: string;
  CONTACT: string;
}

const id = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

/** Only browser push services may be used as endpoints, so the Worker can't be pointed at arbitrary hosts. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
function isPushService(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}
const MAX_SUBS = 5000;
const subscription = z.object({
  endpoint: z.string().url().max(1000).refine(isPushService, 'not a push service'),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const putBody = z.object({
  id,
  subscription,
  timeZone: z.string().max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }),
  reminders: z.array(reminderSchema).max(30),
  quietHours: z.object({ enabled: z.boolean(), start: hhmm, end: hhmm }),
  motivation: z.boolean(),
  snoozeMinutes: z.number().int().min(5).max(240),
  skipIfDone: z.boolean().optional().default(false),
  repeatMinutes: z.number().int().min(0).max(240).optional().default(15),
});
const endpointBody = z.object({ id, subscription });
const idBody = z.object({ id });
const doneBody = z.object({ id, kind: z.string().regex(/^(weigh|habits|photo|habit:[A-Za-z0-9_-]{1,80})$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const actionBody = z.object({ id, reminderId: z.string().max(80), action: z.enum(['snooze', 'skip']) });

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

function json(data: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
}

async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | null> {
  if (Number(req.headers.get('Content-Length') ?? 0) > 64_000) return null;
  try {
    const text = await req.text();
    if (text.length > 64_000) return null;
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

interface Row {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  tz: string;
  config: string;
  state: string;
}

async function loadState(env: Env, subId: string): Promise<{ row: Row; state: SubState } | null> {
  const row = await env.DB.prepare('SELECT * FROM subs WHERE id = ?').bind(subId).first<Row>();
  return row ? { row, state: { ...EMPTY_STATE, ...(JSON.parse(row.state) as SubState) } } : null;
}

async function saveState(env: Env, subId: string, state: SubState) {
  await env.DB.prepare('UPDATE subs SET state = ? WHERE id = ?').bind(JSON.stringify(state), subId).run();
}

async function handle(req: Request, env: Env): Promise<Response> {
  const h = cors(req, env);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const url = new URL(req.url);
  const { pathname } = url;

  // wake-up trigger from iPhone Shortcuts (no browser Origin); the device token is the secret
  if (pathname === '/v1/wake' && (req.method === 'GET' || req.method === 'POST')) {
    const parsed = id.safeParse(url.searchParams.get('id') ?? '');
    if (!parsed.success) return new Response('bad id', { status: 400 });
    const s = await loadState(env, parsed.data);
    if (!s) return new Response('unknown', { status: 404 });
    const st = s.state as SubState & { lastWake?: number };
    if (Date.now() - (st.lastWake ?? 0) < 20 * 60_000) return new Response('ok: already sent recently', { status: 200 });
    const cfg = JSON.parse(s.row.config) as SubConfig;
    const { delivery, state } = wakeDelivery(cfg, s.state, new Date(), s.row.tz);
    await saveState(env, s.row.id, { ...state, lastWake: Date.now() } as SubState);
    if (!delivery) return new Response('ok: already weighed or skipped today', { status: 200 });
    const status = await sendPush(env, s.row, { title: delivery.title, body: delivery.body, url: delivery.url, tag: delivery.tag, reminderId: delivery.reminder.id, kind: 'weigh', sub: s.row.id });
    return new Response(status < 300 ? 'ok: reminder sent' : `push failed: ${status}`, { status: 200 });
  }

  if (!h['Access-Control-Allow-Origin'] && req.method !== 'GET') return json({ error: 'origin' }, 403, h);

  if (pathname === '/v1/health') return json({ ok: true }, 200, h);

  if (pathname === '/v1/subscription' && req.method === 'PUT') {
    const b = await readJson(req, putBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    const known = await env.DB.prepare('SELECT 1 FROM subs WHERE id = ?').bind(b.id).first();
    if (!known) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM subs').first<{ n: number }>();
      if ((n?.n ?? 0) >= MAX_SUBS) return json({ error: 'full' }, 503, h);
    }
    const cfg: SubConfig = { reminders: b.reminders, quietHours: b.quietHours, motivation: b.motivation, snoozeMinutes: b.snoozeMinutes, skipIfDone: b.skipIfDone, repeatMinutes: b.repeatMinutes };
    await env.DB.prepare(
      `INSERT INTO subs (id, endpoint, p256dh, auth, tz, config, state, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET endpoint = ?2, p256dh = ?3, auth = ?4, tz = ?5, config = ?6, updated_at = ?8`,
    )
      .bind(b.id, b.subscription.endpoint, b.subscription.keys.p256dh, b.subscription.keys.auth, b.timeZone, JSON.stringify(cfg), JSON.stringify(EMPTY_STATE), Date.now())
      .run();
    return json({ ok: true }, 200, h);
  }

  if (pathname === '/v1/subscription/endpoint' && req.method === 'POST') {
    const b = await readJson(req, endpointBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    await env.DB.prepare('UPDATE subs SET endpoint = ?, p256dh = ?, auth = ?, updated_at = ? WHERE id = ?')
      .bind(b.subscription.endpoint, b.subscription.keys.p256dh, b.subscription.keys.auth, Date.now(), b.id)
      .run();
    return json({ ok: true }, 200, h);
  }

  if (pathname === '/v1/subscription' && req.method === 'DELETE') {
    const b = await readJson(req, idBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(b.id).run();
    return json({ ok: true }, 200, h);
  }

  if (pathname === '/v1/done' && req.method === 'POST') {
    const b = await readJson(req, doneBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    const s = await loadState(env, b.id);
    if (!s) return json({ error: 'unknown' }, 404, h);
    await saveState(env, b.id, { ...s.state, done: { ...s.state.done, [b.kind]: b.date } });
    return json({ ok: true }, 200, h);
  }

  if (pathname === '/v1/action' && req.method === 'POST') {
    const b = await readJson(req, actionBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    const s = await loadState(env, b.id);
    if (!s) return json({ error: 'unknown' }, 404, h);
    const cfg = JSON.parse(s.row.config) as SubConfig;
    const next =
      b.action === 'skip'
        ? { ...s.state, skip: { ...s.state.skip, [b.reminderId]: wallDate(wallClock(new Date(), s.row.tz)) } }
        : applySnooze(s.state, b.reminderId, Date.now(), cfg.snoozeMinutes);
    await saveState(env, b.id, next);
    return json({ ok: true }, 200, h);
  }

  if (pathname === '/v1/test' && req.method === 'POST') {
    const b = await readJson(req, idBody);
    if (!b) return json({ error: 'invalid' }, 400, h);
    const s = await loadState(env, b.id);
    if (!s) return json({ error: 'unknown' }, 404, h);
    const last = (s.state as SubState & { lastTest?: number }).lastTest ?? 0;
    if (Date.now() - last < 30_000) return json({ error: 'rate' }, 429, h);
    await saveState(env, b.id, { ...s.state, lastTest: Date.now() } as SubState);
    const status = await sendPush(env, s.row, { title: 'FORMA', body: 'Проверка: фоновые уведомления работают.', url: './#/', tag: 'forma-test', reminderId: '', kind: 'custom', sub: s.row.id });
    return json({ ok: status >= 200 && status < 300, status }, 200, h);
  }

  return json({ error: 'not found' }, 404, h);
}

async function sendPush(env: Env, row: Row, payload: Record<string, string>): Promise<number> {
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: env.VAPID_PRIVATE_JWK,
    subscription: { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    message: { payload, adminContact: env.CONTACT, options: { ttl: 6 * 60 * 60, urgency: 'normal' } },
  });
  const res = await fetch(endpoint, { method: 'POST', headers, body });
  return res.status;
}

async function runSchedule(env: Env, now: Date) {
  const { results } = await env.DB.prepare('SELECT * FROM subs LIMIT 5000').all<Row>();
  for (const row of results) {
    let cfg: SubConfig;
    let state: SubState;
    try {
      cfg = JSON.parse(row.config) as SubConfig;
      state = { ...EMPTY_STATE, ...(JSON.parse(row.state) as SubState) };
    } catch {
      continue;
    }
    const { deliveries, state: nextState, changed } = dueDeliveries(cfg, state, now, row.tz);
    let gone = false;
    // a failed send is not marked as delivered, so the next cron tick (within the lookback window) retries it
    const retry = (rid: string) => {
      if (rid in state.fired) nextState.fired[rid] = state.fired[rid];
      else delete nextState.fired[rid];
      if (rid in state.snooze) nextState.snooze[rid] = state.snooze[rid];
    };
    for (const d of deliveries) {
      try {
        const status = await sendPush(env, row, { title: d.title, body: d.body, url: d.url, tag: d.tag, reminderId: d.reminder.id, kind: d.reminder.kind, sub: row.id });
        console.log('push', d.reminder.kind, status);
        if (status === 404 || status === 410) gone = true;
        else if (status >= 300) retry(d.reminder.id);
      } catch (e) {
        console.warn('push error', (e as Error).message);
        retry(d.reminder.id);
      }
    }
    if (gone) await env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id).run();
    else if (changed) await saveState(env, row.id, nextState);
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  scheduled: (_c: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runSchedule(env, new Date()));
  },
} satisfies ExportedHandler<Env>;
