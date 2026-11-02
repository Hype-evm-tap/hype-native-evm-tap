/**
 * Hype Tap — Cloudflare Worker (Hono + D1)
 * Merged from your body.user backend + critical fixes
 *
 * FIXES:
 *  1) /api/tap returns `balance` (was missing → UI reset to 0)
 *  2) GET /api/referrals returns real list (was hard-coded [])
 *  3) GET /api/withdrawals fixed (was hard-coded [])
 *  4) Atomic energy debit
 *  5) energy_reset_at always in unix SECONDS
 *  6) Admin sync on login
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
  BOT_TOKEN?: string;
  ADMIN_ID?: string;
  ADMIN_IDS?: string;
  BOT_USERNAME?: string;
  WALLETCONNECT_PROJECT_ID?: string;
  VITE_WALLETCONNECT_PROJECT_ID?: string;
  MIN_WITHDRAW?: string;
  TAP_REWARD?: string;
  REFERRAL_REWARD?: string;
  ENERGY_MAX?: string;
  ENERGY_COOLDOWN_SEC?: string;
};

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  start_param?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: { tgUser: TgUser } }>();
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data'],
}));

const DEFAULTS: Record<string, string> = {
  tap_reward: '0.0000000695',
  referral_reward: '0.00008526',
  min_withdraw: '2',
  energy_max: '1000',
  energy_cooldown: '3600',
  daily_checkin_reward: '0.0000089',
  streak_bonus: '0',
  checkin_day_rewards: JSON.stringify([0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004]),
};

function toUnixSeconds(value: any): number {
  const n = Number(value) || 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n > 1e12 ? n / 1000 : n);
}
function nowSec() { return Math.floor(Date.now() / 1000); }

async function getSetting(db: D1Database, key: string): Promise<string> {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value != null) return row.value;
  } catch {}
  return DEFAULTS[key] ?? '';
}

async function getConfiguredSetting(db: D1Database, key: string, envValue?: string): Promise<string> {
  try {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value != null && row.value !== '') return String(row.value);
  } catch {}
  if (envValue != null && envValue !== '') return String(envValue);
  return DEFAULTS[key] ?? '';
}

async function setSetting(db: D1Database, key: string, value: string) {
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, String(value)).run();
}

async function getConfig(db: D1Database, env?: Bindings) {
  let dayRewards: number[];
  try {
    dayRewards = JSON.parse(await getSetting(db, 'checkin_day_rewards'));
    if (!Array.isArray(dayRewards) || dayRewards.length !== 7) throw new Error('bad');
  } catch {
    dayRewards = [0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004];
  }
  const cfg: any = {
    tap_reward: parseFloat(await getConfiguredSetting(db, 'tap_reward', env?.TAP_REWARD)),
    referral_reward: parseFloat(await getConfiguredSetting(db, 'referral_reward', env?.REFERRAL_REWARD)),
    min_withdraw: parseFloat(await getConfiguredSetting(db, 'min_withdraw', env?.MIN_WITHDRAW)),
    energy_max: parseFloat(await getConfiguredSetting(db, 'energy_max', env?.ENERGY_MAX)),
    energy_cooldown: parseFloat(await getConfiguredSetting(db, 'energy_cooldown', env?.ENERGY_COOLDOWN_SEC)),
    daily_checkin_reward: parseFloat(await getSetting(db, 'daily_checkin_reward')),
    streak_bonus: parseFloat(await getSetting(db, 'streak_bonus')) || 0,
    checkin_day_rewards: dayRewards,
    bot_username: env?.BOT_USERNAME || '',
  };
  return cfg;
}

function computeCanCheckin(lastCheckinAt: number) {
  if (!lastCheckinAt) return { can: true, wait: 0 };
  const lastSec = toUnixSeconds(lastCheckinAt);
  const elapsed = nowSec() - lastSec;
  if (elapsed < 86400) return { can: false, wait: 86400 - elapsed };
  return { can: true, wait: 0 };
}

function isStreakBroken(lastCheckinAt: number) {
  if (!lastCheckinAt) return false;
  return nowSec() - toUnixSeconds(lastCheckinAt) > 86400 * 2;
}


async function verifyTelegramInitData(raw: string, botToken: string): Promise<TgUser | null> {
  if (!raw || !botToken) return null;
  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    params.delete('hash');
    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || authDate > nowSec() + 60 || nowSec() - authDate > 86400) return null;
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const enc = new TextEncoder();
    const webAppKey = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    // Telegram requires HMAC-SHA256(key="WebAppData", message=bot_token).
    // The previous implementation reversed these inputs and rejected every valid initData payload.
    const secret = await crypto.subtle.sign('HMAC', webAppKey, enc.encode(botToken));
    const hmacKey = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(dataCheckString)));
    const actual = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    let diff = actual.length ^ hash.length;
    for (let i = 0; i < Math.min(actual.length, hash.length); i++) diff |= actual.charCodeAt(i) ^ hash.toLowerCase().charCodeAt(i);
    if (diff !== 0) return null;
    const userRaw = params.get('user');
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    if (!Number.isSafeInteger(Number(user?.id)) || Number(user.id) <= 0) return null;
    return { id: Number(user.id), username: user.username || '', first_name: user.first_name || '', last_name: user.last_name || '', start_param: params.get('start_param') || '' };
  } catch { return null; }
}

function adminSet(env: Bindings) {
  const raw = [env.ADMIN_ID || '', env.ADMIN_IDS || ''].join(',');
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number));
}

async function ensureUser(db: D1Database, env: Bindings, tgUser: TgUser, startParam?: string | null) {
  if (!tgUser?.id) throw new Error('No user');
  let u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  const energyMax = parseFloat(await getConfiguredSetting(db, 'energy_max', env.ENERGY_MAX)) || 1000;
  const shouldAdmin = adminSet(env).has(Number(tgUser.id)) ? 1 : 0;

  if (!u) {
    await db.prepare(
      `INSERT INTO users (id, username, first_name, last_name, energy, is_admin, created_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))`
    ).bind(tgUser.id, tgUser.username || '', tgUser.first_name || '', tgUser.last_name || '', energyMax, shouldAdmin).run();

    if (startParam) {
      const refText = String(startParam).trim();
      const refMatch = refText.match(/^(?:ref_)?([1-9]\d{0,19})$/i);
      const refId = refMatch ? Number(refMatch[1]) : 0;
      if (refId && refId !== tgUser.id) {
        const ref = await db.prepare('SELECT id FROM users WHERE id = ?').bind(refId).first();
        if (ref) {
          const reward = parseFloat(await getConfiguredSetting(db, 'referral_reward', env.REFERRAL_REWARD)) || 0;
          const ins = await db.prepare('INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)').bind(refId, tgUser.id, reward).run();
          if ((ins?.meta?.changes ?? 0) > 0) {
            await db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND (referred_by IS NULL OR referred_by = 0)').bind(refId, tgUser.id).run();
            await db.prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?').bind(reward, reward, refId).run();
          }
        }
      }
    }
    u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  } else {
    await db.prepare(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, last_active = strftime('%s','now') WHERE id = ?`
    ).bind(tgUser.username || u.username, tgUser.first_name || u.first_name, tgUser.last_name || u.last_name, tgUser.id).run();
    u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  }

  const resetAt = toUnixSeconds(u.energy_reset_at);
  if (Number(u.energy) <= 0 && (resetAt <= 0 || nowSec() >= resetAt)) {
    await db.prepare('UPDATE users SET energy = ?, energy_reset_at = 0 WHERE id = ?').bind(energyMax, u.id).run();
    u.energy = energyMax;
    u.energy_reset_at = 0;
  }

  if (isStreakBroken(Number(u.last_checkin_at) || 0) && Number(u.checkin_streak) > 0) {
    await db.prepare('UPDATE users SET checkin_streak = 0 WHERE id = ?').bind(u.id).run();
    u.checkin_streak = 0;
  }
  return u;
}

function publicUser(u: any, env: Bindings) {
  const last = toUnixSeconds(u.last_checkin_at);
  const { can, wait } = computeCanCheckin(last);
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    balance: Number(u.balance) || 0,
    total_earned: Number(u.total_earned) || 0,
    total_taps: Number(u.total_taps) || 0,
    energy: Number(u.energy) || 0,
    energy_reset_at: toUnixSeconds(u.energy_reset_at),
    invite_count: Number(u.invite_count) || 0,
    wallet_address: u.wallet_address || '',
    is_admin: !!u.is_admin || adminSet(env).has(Number(u.id)),
    last_checkin_at: last,
    can_checkin: can,
    checkin_wait: wait,
    checkin_streak: Number(u.checkin_streak) || 0,
    streak: Number(u.checkin_streak) || 0,
    checkin_total_earned: Number(u.checkin_total_earned) || 0,
  };
}

async function listReferrals(db: D1Database, userId: number) {
  const { results } = await db.prepare(
    `SELECT r.id, r.referrer_id, r.referred_id, r.reward, r.created_at,
            u.username, u.first_name, u.total_earned, u.total_taps
     FROM referrals r LEFT JOIN users u ON u.id = r.referred_id
     WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT 200`
  ).bind(userId).all();
  const list = (results || []) as any[];
  const seen = new Set(list.map((r) => String(r.referred_id)));
  const legacy = await db.prepare(
    `SELECT id, username, first_name, total_earned, total_taps, created_at FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 200`
  ).bind(userId).all();
  for (const u of (legacy.results || []) as any[]) {
    if (seen.has(String(u.id))) continue;
    list.push({
      id: `legacy-${u.id}`, referrer_id: userId, referred_id: u.id, reward: 0,
      created_at: u.created_at, username: u.username, first_name: u.first_name,
      total_earned: u.total_earned, total_taps: u.total_taps, legacy_record: true,
    });
    seen.add(String(u.id));
  }
  return { referrals: list, count: list.length };
}


app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (['/api/health', '/api/config', '/api/price'].includes(path)) return next();
  const identity = await verifyTelegramInitData(c.req.header('X-Telegram-Init-Data') || '', c.env.BOT_TOKEN || '');
  if (!identity) return c.json({ error: 'Unauthorized: valid Telegram session required' }, 401);
  c.set('tgUser', identity);
  if (path.startsWith('/api/admin/')) {
    const configuredAdmin = adminSet(c.env).has(identity.id);
    const dbUser = configuredAdmin ? null : await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(identity.id).first<any>();
    if (!configuredAdmin && !Number(dbUser?.is_admin)) return c.json({ error: 'Forbidden: admin only' }, 403);
  }
  return next();
});

// ──── Routes ────

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/config', async (c) => {
  const id = c.env.WALLETCONNECT_PROJECT_ID || c.env.VITE_WALLETCONNECT_PROJECT_ID || '';
  return c.json({ walletConnectProjectId: id, bot_username: c.env.BOT_USERNAME || '' });
});

app.get('/api/price', async (c) => {
  let price = 0;
  try {
    const r = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    const mids = (await r.json()) as Record<string, string>;
    price = parseFloat(mids['HYPE'] || mids['@1'] || '0') || 0;
  } catch {}
  return c.json({ symbol: 'HYPE', price, timestamp: nowSec() });
});

app.post('/api/user', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const tgUser = c.get('tgUser');
    if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);
    const startParam = tgUser.start_param || null;
    const u = await ensureUser(c.env.DB, c.env, tgUser, startParam);
    const cfg = await getConfig(c.env.DB, c.env);
    let price = 0;
    try {
      const r = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });
      const mids = (await r.json()) as Record<string, string>;
      price = parseFloat(mids['HYPE'] || mids['@1'] || '0') || 0;
    } catch {}
    return c.json({ user: publicUser(u, c.env), config: cfg, price });
  } catch (e: any) {
    return c.json({ error: e.message || 'Failed' }, 400);
  }
});

app.post('/api/wallet', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const tgUser = c.get('tgUser');
    await ensureUser(c.env.DB, c.env, tgUser, null);
    const addr = String(body.wallet_address || '').trim();
    if (addr && !/^0x[a-fA-F0-9]{40}$/.test(addr)) return c.json({ error: 'Invalid EVM address' }, 400);
    await c.env.DB.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').bind(addr, tgUser.id).run();
    return c.json({ success: true, wallet_address: addr });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Wallet save failed' }, 500);
  }
});

app.post('/api/checkin', async (c) => {
  try {
    const tgUser = c.get('tgUser');
    let u = await ensureUser(c.env.DB, c.env, tgUser, null);
    const last = toUnixSeconds(u.last_checkin_at);
    const { can, wait } = computeCanCheckin(last);
    if (!can) return c.json({ already: true, wait_seconds: wait, error: 'Check-in available after 24-hour cooldown.' }, 429);

    let streak = Number(u.checkin_streak) || 0;
    if (isStreakBroken(last)) streak = 0;
    const nextDay = Math.min(streak + 1, 7);
    const cfg = await getConfig(c.env.DB, c.env);
    let reward = Number((cfg.checkin_day_rewards || [])[nextDay - 1]);
    if (!Number.isFinite(reward) || reward < 0) reward = Number(cfg.daily_checkin_reward) || 0;
    let newStreak = nextDay === 7 ? 0 : nextDay;
    let bonus = 0;
    if (nextDay >= 7) {
      bonus = Number(cfg.streak_bonus) || 0;
      if (bonus > 0) reward += bonus;
    }
    const ts = nowSec();
    const rawLast = u.last_checkin_at ?? 0;
    const claim = await c.env.DB.prepare(
      `UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, last_checkin_at = ?,
       checkin_streak = ?, checkin_total_earned = COALESCE(checkin_total_earned, 0) + ?, last_active = ?
       WHERE id = ? AND COALESCE(last_checkin_at, 0) = ?`
    ).bind(reward, reward, ts, newStreak, reward, ts, u.id, rawLast).run();
    if ((claim.meta?.changes ?? 0) === 0) return c.json({ already: true, wait_seconds: 86400, error: 'Already checked in' }, 409);
    const updated = await c.env.DB.prepare('SELECT balance, checkin_streak, checkin_total_earned FROM users WHERE id = ?').bind(u.id).first<any>();
    return c.json({
      success: true, reward, streak: nextDay, next_streak: newStreak, day: nextDay, bonus,
      streak_total: Number(updated?.checkin_total_earned ?? 0), balance: Number(updated?.balance) || 0,
      last_checkin_at: ts, wait_seconds: 86400,
    });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Check-in failed' }, 500);
  }
});

app.post('/api/tap', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const tgUser = c.get('tgUser');
    let u = await ensureUser(c.env.DB, c.env, tgUser, null);
    const cfg = await getConfig(c.env.DB, c.env);
    const energyMax = cfg.energy_max || 1000;
    const cooldownSec = cfg.energy_cooldown || 3600;
    const rewardPer = cfg.tap_reward || 0;
    const t = nowSec();
    let energy = Math.max(0, Number(u.energy) || 0);
    let resetAt = toUnixSeconds(u.energy_reset_at);

    if (energy <= 0 && (resetAt <= 0 || t >= resetAt)) {
      await c.env.DB.prepare('UPDATE users SET energy = ?, energy_reset_at = 0 WHERE id = ? AND energy <= 0').bind(energyMax, u.id).run();
      u = (await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>()) || u;
      energy = Math.max(0, Number(u.energy) || 0);
      resetAt = toUnixSeconds(u.energy_reset_at);
    }
    if (energy <= 0) {
      return c.json({ error: 'Energy depleted', energy: 0, energy_reset_at: resetAt, balance: Number(u.balance) || 0, wait_seconds: Math.max(0, resetAt - t) }, 429);
    }

    const requestedTaps = Number(body.taps ?? 1);
    if (!Number.isSafeInteger(requestedTaps) || requestedTaps < 1) return c.json({ error: 'Invalid tap count' }, 400);
    const taps = Math.min(50, requestedTaps);
    const actualTaps = Math.min(taps, energy);
    const earned = actualTaps * rewardPer;

    const update = await c.env.DB.prepare(
      `UPDATE users SET
        balance = balance + ?, total_earned = total_earned + ?,
        energy = energy - ?,
        energy_reset_at = CASE WHEN (energy - ?) <= 0 THEN ? ELSE 0 END,
        total_taps = total_taps + ?, last_active = ?
       WHERE id = ? AND energy >= ?`
    ).bind(earned, earned, actualTaps, actualTaps, t + cooldownSec, actualTaps, t, u.id, actualTaps).run();

    if ((update.meta?.changes ?? 0) === 0) {
      const latest = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>();
      const le = Math.max(0, Number(latest?.energy) || 0);
      return c.json({
        error: le <= 0 ? 'Energy depleted' : 'Energy changed. Please retry.',
        energy: le, energy_reset_at: toUnixSeconds(latest?.energy_reset_at), balance: Number(latest?.balance) || 0,
      }, le <= 0 ? 429 : 409);
    }

    const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<any>();
    return c.json({
      success: true,
      earned,
      taps: actualTaps,
      energy: Math.max(0, Number(updated?.energy) || 0),
      energy_reset_at: toUnixSeconds(updated?.energy_reset_at),
      balance: Number(updated?.balance) || 0, // CRITICAL — was missing
    });
  } catch (e: any) {
    return c.json({ error: e.message || 'Tap failed' }, 400);
  }
});

app.get('/api/tasks', async (c) => {
  try {
    const authUser = c.get('tgUser');
    const [{ results: tasks }, { results: completedRows }] = await Promise.all([
      c.env.DB.prepare('SELECT id, title, type, link, reward FROM tasks WHERE is_active = 1 ORDER BY id DESC').all(),
      c.env.DB.prepare('SELECT task_id FROM user_tasks WHERE user_id = ?').bind(authUser.id).all(),
    ]);
    return c.json({ tasks: tasks || [], completed: (completedRows || []).map((row: any) => row.task_id) });
  } catch { return c.json({ tasks: [], completed: [] }); }
});

async function checkTelegramTaskMembership(db: D1Database, env: Bindings, userId: number, taskId: number) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').bind(taskId).first<any>();
  if (!task) return { error: 'Task not found', status: 404 };
  const taskType = String(task.type || '').toLowerCase();
  if (taskType === 'youtube') {
    const youtubeLink = /^(https?:\/\/)?(www\.)?(youtube\.com\/(channel\/|@|c\/|user\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_?&=.-]+/i.test(String(task.link || '').trim());
    if (!youtubeLink) return { error: 'YouTube task link is invalid', status: 422 };
    const claimed = await db.prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?').bind(userId, taskId).first();
    return { task, isMember: true, manual: true, claimed: !!claimed };
  }
  if (taskType !== 'telegram') return { error: 'Unsupported task type', status: 422 };
  if (!env.BOT_TOKEN) return { error: 'Telegram bot token is not configured', status: 503 };
  const match = String(task.link || '').trim().match(/(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{5,})|^@([A-Za-z0-9_]{5,})$/i);
  const channel = match?.[1] ? `@${match[1]}` : match?.[2] ? `@${match[2]}` : '';
  if (!channel) return { error: 'Task link must be a public Telegram channel link or @username', status: 422 };
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`);
  const result: any = await response.json();
  if (!result?.ok) return { error: 'Could not verify channel membership. The bot must be an admin in that channel.', status: 503 };
  const member = result.result;
  const isMember = member && (['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true));
  return { task, isMember: !!isMember };
}

app.post('/api/tasks/verify', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const taskId = Number(body.task_id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return c.json({ error: 'Invalid task id' }, 400);
    const userId = c.get('tgUser').id;
    const check: any = await checkTelegramTaskMembership(c.env.DB, c.env, userId, taskId);
    if (check.error) return c.json({ error: check.error }, check.status);
    const claimed = await c.env.DB.prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?').bind(userId, taskId).first();
    return c.json({ verified: check.isMember, claimed: !!claimed || !!check.claimed, manual: !!check.manual, message: check.manual ? 'YouTube task ready for self-confirmation' : check.isMember ? 'Membership verified' : 'Join the channel first' });
  } catch (e: any) { return c.json({ error: e?.message || 'Task verification failed' }, 400); }
});

app.post('/api/tasks/complete', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const taskId = Number(body.task_id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return c.json({ error: 'Invalid task id' }, 400);
    const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
    const check: any = await checkTelegramTaskMembership(c.env.DB, c.env, u.id, taskId);
    if (check.error) return c.json({ error: check.error }, check.status);
    if (!check.isMember) return c.json({ error: 'Join the Telegram channel first. The bot must be an admin in that channel.' }, 403);
    const taskReward = Number(check.task.reward);
    if (!Number.isFinite(taskReward) || taskReward < 0 || taskReward > 1000000) return c.json({ error: 'Task reward is invalid; contact an admin' }, 422);
    const result = await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR IGNORE INTO user_tasks (user_id, task_id) VALUES (?, ?)').bind(u.id, taskId),
      c.env.DB.prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ? AND changes() > 0').bind(taskReward, taskReward, u.id),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 0) return c.json({ success: true, already_claimed: true, reward: 0 });
    if ((result[1]?.meta?.changes ?? 0) === 0) return c.json({ error: 'Reward could not be credited' }, 500);
    return c.json({ success: true, reward: taskReward });
  } catch (e: any) { return c.json({ error: e?.message || 'Task claim failed' }, 400); }
});

app.get('/api/leaderboard', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, first_name, balance, total_earned, total_taps, invite_count FROM users ORDER BY total_earned DESC LIMIT 100'
  ).all();
  return c.json({ leaderboard: results || [] });
});

// FIX: was hard-coded []
app.get('/api/referrals', async (c) => {
  const authUser = c.get('tgUser');
  return c.json(await listReferrals(c.env.DB, authUser.id));
});

app.post('/api/referrals', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const authUser = c.get('tgUser');
    await ensureUser(c.env.DB, c.env, authUser, null);
    return c.json(await listReferrals(c.env.DB, authUser.id));
  } catch (e: any) { return c.json({ error: e.message }, 400); }
});

app.post('/api/withdraw', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
    const amount = Number(body.amount);
    const wallet = String(body.wallet_address || u.wallet_address || '').trim();
    const min = parseFloat(await getConfiguredSetting(c.env.DB, 'min_withdraw', c.env.MIN_WITHDRAW)) || 2;
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) return c.json({ error: 'Enter a valid HyperEVM wallet address' }, 400);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(min) || amount < min) return c.json({ error: `Min ${min} HYPE` }, 400);
    const result = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET balance = balance - ?, wallet_address = ? WHERE id = ? AND balance >= ?').bind(amount, wallet, u.id, amount),
      c.env.DB.prepare("INSERT INTO withdrawals (user_id, amount, wallet_address, status) SELECT ?, ?, ?, 'pending' WHERE changes() > 0").bind(u.id, amount, wallet),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 0 || (result[1]?.meta?.changes ?? 0) === 0) return c.json({ error: 'Insufficient balance or withdrawal could not be created' }, 400);
    const updated = await c.env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(u.id).first<any>();
    return c.json({ success: true, balance: Number(updated?.balance) || 0, message: 'Withdrawal request submitted' });
  } catch (e: any) { return c.json({ error: e.message }, 400); }
});

app.get('/api/withdrawals', async (c) => {
  const authUser = c.get('tgUser');
  const { results } = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(authUser.id).all();
  return c.json({ withdrawals: results || [] });
});

app.post('/api/withdrawals', async (c) => {
  try {
    const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
    const { results } = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(u.id).all();
    return c.json({ withdrawals: results || [] });
  } catch { return c.json({ withdrawals: [] }); }
});

// Admin
app.get('/api/admin/stats', async (c) => {
  const users = (await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<any>())?.c || 0;
  const earned = (await c.env.DB.prepare('SELECT SUM(total_earned) AS s FROM users').first<any>())?.s || 0;
  const totalBal = (await c.env.DB.prepare('SELECT SUM(balance) AS s FROM users').first<any>())?.s || 0;
  const pending = (await c.env.DB.prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'").first<any>())?.c || 0;
  return c.json({ total_users: users, users, total_earned: earned, earned, total_balance: totalBal, pending_withdrawals: pending });
});

app.get('/api/admin/withdrawals', async (c) => {
  const status = c.req.query('status') || 'pending';
  if (!['pending', 'processing', 'approved', 'rejected'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, u.username, u.first_name FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.id DESC LIMIT 100`
  ).bind(status).all();
  return c.json({ withdrawals: results || [] });
});

app.post('/api/admin/withdrawals/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const statusMap: Record<string, string> = { approve: 'approved', reject: 'rejected', processing: 'processing' };
  const status = statusMap[body.action];
  if (!status) return c.json({ error: 'Invalid action' }, 400);
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid withdrawal id' }, 400);
  const statements = [
    c.env.DB.prepare("UPDATE withdrawals SET status = ?, processed_at = strftime('%s','now') WHERE id = ? AND status IN ('pending','processing')").bind(status, id),
    c.env.DB.prepare("UPDATE users SET balance = balance + (SELECT amount FROM withdrawals WHERE id = ?) WHERE id = (SELECT user_id FROM withdrawals WHERE id = ?) AND ? = 'rejected' AND changes() > 0").bind(id, id, status),
  ];
  const results = await c.env.DB.batch(statements);
  if ((results[0]?.meta?.changes ?? 0) === 0) return c.json({ error: 'Withdrawal not found or already processed' }, 409);
  return c.json({ success: true, status });
});
app.get('/api/admin/tasks', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  return c.json({ tasks: results || [] });
});
app.post('/api/admin/tasks', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const title = String(b.title || '').trim().slice(0, 120);
  const type = String(b.type || 'telegram').trim().toLowerCase();
  const link = String(b.link || '').trim().slice(0, 500);
  const reward = Number(b.reward);
  const telegramChannel = /^(?:https?:\/\/)?(?:www\.)?t\.me\/[A-Za-z0-9_]{5,}\/?$|^@[A-Za-z0-9_]{5,}$/i.test(link);
  const youtubeLink = /^(https?:\/\/)?(www\.)?(youtube\.com\/(channel\/|@|c\/|user\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_?&=.-]+/i.test(link);
  const validLink = (type === 'telegram' && telegramChannel) || (type === 'youtube' && youtubeLink);
  if (!title || !validLink || !['telegram', 'youtube'].includes(type) || !Number.isFinite(reward) || reward < 0 || reward > 1000000) return c.json({ error: 'Enter a valid public t.me or YouTube channel/video link, title and reward' }, 400);
  const info = await c.env.DB.prepare('INSERT INTO tasks (title, type, link, reward, is_active) VALUES (?, ?, ?, ?, 1)').bind(title, type, link, reward).run();
  return c.json({ success: true, id: info.meta.last_row_id });
});
app.delete('/api/admin/tasks/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid task id' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_tasks WHERE task_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});
app.get('/api/admin/settings', async (c) => c.json({ settings: await getConfig(c.env.DB, c.env) }));
app.post('/api/admin/settings', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const bounds: Record<string, [number, number]> = { tap_reward: [0, 1000000], referral_reward: [0, 1000000], min_withdraw: [0.00000001, 1000000], energy_max: [1, 1000000], energy_cooldown: [60, 604800], daily_checkin_reward: [0, 1000000], streak_bonus: [0, 1000000] };
  const values: Array<[string, string]> = [];
  for (const [k, [minValue, maxValue]] of Object.entries(bounds)) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < minValue || n > maxValue) return c.json({ error: `Invalid ${k}` }, 400);
    values.push([k, String(n)]);
  }
  if (b.checkin_day_rewards !== undefined) {
    if (!Array.isArray(b.checkin_day_rewards) || b.checkin_day_rewards.length !== 7 || b.checkin_day_rewards.some((v: any) => !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1000000)) return c.json({ error: 'checkin_day_rewards must contain 7 valid non-negative numbers' }, 400);
    values.push(['checkin_day_rewards', JSON.stringify(b.checkin_day_rewards.map(Number))]);
  }
  if (values.length) await c.env.DB.batch(values.map(([key, value]) => c.env.DB.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value)));
  return c.json({ success: true, settings: await getConfig(c.env.DB, c.env) });
});
app.get('/api/admin/leaderboard', async (c) => {
  const limit = Math.max(1, Math.min(100, Number.parseInt(c.req.query('limit') || '50', 10) || 50));
  const { results } = await c.env.DB.prepare('SELECT id, username, first_name, balance, total_earned, total_taps, invite_count, is_admin FROM users ORDER BY total_earned DESC LIMIT ?').bind(limit).all();
  return c.json({ leaderboard: results || [] });
});
app.get('/api/admin/referrals', async (c) => {
  const limit = Math.max(1, Math.min(100, Number.parseInt(c.req.query('limit') || '50', 10) || 50));
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u1.username as referrer_name, u2.username as referred_name FROM referrals r
     LEFT JOIN users u1 ON r.referrer_id = u1.id LEFT JOIN users u2 ON r.referred_id = u2.id
     ORDER BY r.id DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ referrals: results || [] });
});
app.get('/api/admin/users/:id', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!u) return c.json({ error: 'Not found' }, 404);
  return c.json({ user: publicUser(u, c.env) });
});
app.post('/api/admin/users/:id', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid user id' }, 400);
  const fields: Record<string, number> = {};
  for (const k of ['balance', 'total_earned', 'total_taps', 'invite_count'] as const) {
    if (b[k] === undefined || b[k] === null) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e15 || (k !== 'balance' && k !== 'total_earned' && !Number.isSafeInteger(n))) return c.json({ error: `Invalid ${k}` }, 400);
    fields[k] = n;
  }
  if (b.is_admin !== undefined && typeof b.is_admin !== 'boolean' && b.is_admin !== 0 && b.is_admin !== 1) return c.json({ error: 'Invalid is_admin' }, 400);
  await c.env.DB.prepare(
    `UPDATE users SET balance = COALESCE(?, balance), total_earned = COALESCE(?, total_earned), total_taps = COALESCE(?, total_taps), is_admin = COALESCE(?, is_admin), invite_count = COALESCE(?, invite_count) WHERE id = ?`
  ).bind(fields.balance ?? null, fields.total_earned ?? null, fields.total_taps ?? null, b.is_admin == null ? null : (b.is_admin ? 1 : 0), id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!updated) return c.json({ error: 'User not found' }, 404);
  return c.json({ success: true, user: publicUser(updated, c.env) });
});
app.delete('/api/admin/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid user id' }, 400);
  if (id === c.get('tgUser').id || adminSet(c.env).has(id)) return c.json({ error: 'Cannot delete your own account or a configured administrator' }, 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_tasks WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').bind(id, id),
    c.env.DB.prepare('DELETE FROM withdrawals WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return c.json({ success: true });
});
app.post('/api/admin/broadcast', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const message = String(body.message || '').trim();
  const photo = String(body.photo || '').trim();
  if ((!message && !photo) || message.length > 1024 && photo || message.length > 4096) return c.json({ error: 'Message must be 1–4096 characters, or a photo with a caption up to 1024 characters' }, 400);
  if (photo && !/^https:\/\//i.test(photo)) return c.json({ error: 'Photo URL must use HTTPS' }, 400);
  if (!c.env.BOT_TOKEN) return c.json({ error: 'Telegram bot token is not configured' }, 503);
  const { results } = await c.env.DB.prepare('SELECT id FROM users ORDER BY id').all();
  let sent = 0, failed = 0;
  for (const row of (results || []) as any[]) {
    try {
      const method = photo ? 'sendPhoto' : 'sendMessage';
      const payload = photo ? { chat_id: row.id, photo, caption: message || undefined } : { chat_id: row.id, text: message, disable_web_page_preview: true };
      const response = await fetch(`https://api.telegram.org/bot${c.env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result: any = await response.json();
      if (response.ok && result?.ok) sent++; else failed++;
    } catch { failed++; }
  }
  await c.env.DB.prepare('INSERT INTO broadcasts (message, sent_by, success_count) VALUES (?, ?, ?)').bind(message, c.get('tgUser').id, sent).run();
  return c.json({ success: true, sent, failed, total: (results || []).length });
});

app.all('*', async (c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.text('404 — Frontend assets missing. Run: cd frontend && npm run build then wrangler deploy', 404);
});

export default app;
