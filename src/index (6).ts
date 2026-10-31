/**
 * Hype Tap — Cloudflare Worker (Hono + D1)
 * 7-day daily check-in streak + external wallet connect
 *
 * Bindings (wrangler.toml):
 *   [[d1_databases]]
 *   binding = "DB"
 *   database_name = "hype-tap-db"
 *   database_id = "..."
 *
 * [vars]
 *   ADMIN_IDS = "123456789"
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
  ASSETS?: Fetcher;
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
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('*', cors());

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULTS: Record<string, string> = {
  tap_reward: '0.0000000695',
  referral_reward: '0.001',
  min_withdraw: '1',
  energy_max: '1000',
  energy_cooldown: '3600',
  daily_checkin_reward: '0.001',
  streak_bonus: '2000',
  checkin_day_rewards: JSON.stringify([50, 100, 150, 300, 500, 800, 1200]),
};

function startOfUTCDay(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  if (row?.value != null) return row.value;
  return DEFAULTS[key] ?? '';
}

async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value))
    .run();
}

async function getConfig(db: D1Database) {
  let dayRewards: number[];
  try {
    dayRewards = JSON.parse(await getSetting(db, 'checkin_day_rewards'));
  } catch {
    dayRewards = [50, 100, 150, 300, 500, 800, 1200];
  }
  return {
    tap_reward: parseFloat(await getSetting(db, 'tap_reward')),
    referral_reward: parseFloat(await getSetting(db, 'referral_reward')),
    min_withdraw: parseFloat(await getSetting(db, 'min_withdraw')),
    energy_max: parseFloat(await getSetting(db, 'energy_max')),
    energy_cooldown: parseFloat(await getSetting(db, 'energy_cooldown')),
    daily_checkin_reward: parseFloat(await getSetting(db, 'daily_checkin_reward')),
    streak_bonus: parseFloat(await getSetting(db, 'streak_bonus')),
    checkin_day_rewards: dayRewards,
  };
}

function computeCanCheckin(lastCheckinAt: number) {
  if (!lastCheckinAt) return { can: true, wait: 0 };
  const lastDay = startOfUTCDay(lastCheckinAt * (lastCheckinAt < 1e12 ? 1000 : 1));
  // support both seconds and ms timestamps
  const lastMs = lastCheckinAt < 1e12 ? lastCheckinAt * 1000 : lastCheckinAt;
  const lastDayMs = startOfUTCDay(lastMs);
  const today = startOfUTCDay();
  if (lastDayMs === today) {
    return { can: false, wait: Math.max(0, today + DAY_MS - Date.now()) };
  }
  return { can: true, wait: 0 };
}

function isStreakBroken(lastCheckinAt: number) {
  if (!lastCheckinAt) return false;
  const lastMs = lastCheckinAt < 1e12 ? lastCheckinAt * 1000 : lastCheckinAt;
  const lastDay = startOfUTCDay(lastMs);
  const today = startOfUTCDay();
  return lastDay < today - DAY_MS;
}

function adminSet(env: Bindings) {
  const raw = [env.ADMIN_ID || '', env.ADMIN_IDS || ''].join(',');
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
  );
}

async function ensureUser(db: D1Database, env: Bindings, tgUser: TgUser, startParam?: string | null) {
  if (!tgUser?.id) throw new Error('No user');
  let u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  const energyMax = parseFloat(await getSetting(db, 'energy_max')) || 1000;

  if (!u) {
    const isAdmin = adminSet(env).has(Number(tgUser.id)) ? 1 : 0;
    await db
      .prepare(
        `INSERT INTO users (id, username, first_name, last_name, energy, is_admin, created_at, last_active)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'), strftime('%s','now'))`
      )
      .bind(
        tgUser.id,
        tgUser.username || '',
        tgUser.first_name || '',
        tgUser.last_name || '',
        energyMax,
        isAdmin
      )
      .run();

    // referral
    if (startParam) {
      const refId = parseInt(String(startParam).replace(/\D/g, ''), 10);
      if (refId && refId !== tgUser.id) {
        const ref = await db.prepare('SELECT id FROM users WHERE id = ?').bind(refId).first();
        if (ref) {
          const reward = parseFloat(await getSetting(db, 'referral_reward')) || 0;
          await db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').bind(refId, tgUser.id).run();
          await db
            .prepare(
              'UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?'
            )
            .bind(reward, reward, refId)
            .run();
          await db
            .prepare('INSERT INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)')
            .bind(refId, tgUser.id, reward)
            .run();
        }
      }
    }
    u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  } else {
    await db
      .prepare(
        `UPDATE users SET username = ?, first_name = ?, last_name = ?, last_active = strftime('%s','now') WHERE id = ?`
      )
      .bind(tgUser.username || u.username, tgUser.first_name || u.first_name, tgUser.last_name || u.last_name, tgUser.id)
      .run();
    u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(tgUser.id).first<any>();
  }

  // energy regen
  const cooldownSec = parseFloat(await getSetting(db, 'energy_cooldown')) || 3600;
  const resetAt = Number(u.energy_reset_at) || 0;
  const resetMs = resetAt > 0 && resetAt < 1e12 ? resetAt * 1000 : resetAt;
  if (Number(u.energy) <= 0 && resetMs && Date.now() >= resetMs) {
    await db.prepare('UPDATE users SET energy = ?, energy_reset_at = 0 WHERE id = ?').bind(energyMax, u.id).run();
    u.energy = energyMax;
    u.energy_reset_at = 0;
  }

  // auto-reset broken streak
  if (isStreakBroken(Number(u.last_checkin_at) || 0) && Number(u.checkin_streak) > 0) {
    await db.prepare('UPDATE users SET checkin_streak = 0 WHERE id = ?').bind(u.id).run();
    u.checkin_streak = 0;
  }

  return u;
}

function publicUser(u: any, env: Bindings) {
  const last = Number(u.last_checkin_at) || 0;
  const { can, wait } = computeCanCheckin(last);
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    balance: u.balance,
    total_earned: u.total_earned,
    total_taps: u.total_taps,
    energy: u.energy,
    energy_reset_at: u.energy_reset_at < 1e12 && u.energy_reset_at > 0 ? u.energy_reset_at * 1000 : u.energy_reset_at,
    invite_count: u.invite_count,
    wallet_address: u.wallet_address || '',
    is_admin: !!u.is_admin || adminSet(env).has(Number(u.id)),
    can_checkin: can,
    checkin_wait: wait,
    checkin_streak: u.checkin_streak || 0,
    streak: u.checkin_streak || 0,
    checkin_total_earned: u.checkin_total_earned || 0,
  };
}

// ───────── Routes ─────────

app.get('/api/config', async (c) => {
  const id =
    c.env.WALLETCONNECT_PROJECT_ID ||
    c.env.VITE_WALLETCONNECT_PROJECT_ID ||
    '';
  return c.json({
    walletConnectProjectId: id,
    bot_username: c.env.BOT_USERNAME || '',
  });
});

app.post('/api/user', async (c) => {
  try {
    const body = await c.req.json();
    const u = await ensureUser(c.env.DB, c.env, body.user, body.start_param);
    const cfg = await getConfig(c.env.DB);
    // Prefer Cloudflare [vars] when DB settings empty/default
    if (c.env.TAP_REWARD) cfg.tap_reward = parseFloat(c.env.TAP_REWARD);
    if (c.env.REFERRAL_REWARD) cfg.referral_reward = parseFloat(c.env.REFERRAL_REWARD);
    if (c.env.MIN_WITHDRAW) cfg.min_withdraw = parseFloat(c.env.MIN_WITHDRAW);
    if (c.env.ENERGY_MAX) cfg.energy_max = parseFloat(c.env.ENERGY_MAX);
    if (c.env.ENERGY_COOLDOWN_SEC) cfg.energy_cooldown = parseFloat(c.env.ENERGY_COOLDOWN_SEC);
    (cfg as any).bot_username = c.env.BOT_USERNAME || '';
    return c.json({ user: publicUser(u, c.env), config: cfg, price: 0 });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.post('/api/wallet', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const tgUser = body.user as TgUser;
    if (!tgUser?.id) return c.json({ error: 'User required' }, 400);
    await ensureUser(c.env.DB, c.env, tgUser, null);
    const addr = String(body.wallet_address || '').trim();
    if (addr && !/^0x[a-fA-F0-9]{40}$/.test(addr) && addr !== '') {
      return c.json({ error: 'Invalid EVM address' }, 400);
    }
    await c.env.DB.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').bind(addr, tgUser.id).run();
    return c.json({ success: true, wallet_address: addr });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Wallet save failed' }, 500);
  }
});

/**
 * Daily check-in — 7 day streak
 * Miss a UTC day → streak resets, this claim is Day 1
 * Day 7 → +streak_bonus, streak resets to 0
 */
app.post('/api/checkin', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const tgUser = body.user as TgUser;
    if (!tgUser?.id) {
      return c.json({ error: 'User required — open from Telegram' }, 400);
    }

    let u = await ensureUser(c.env.DB, c.env, tgUser, null);
    const last = Number(u.last_checkin_at) || 0;
    const { can, wait } = computeCanCheckin(last);

    if (!can) {
      return c.json({ already: true, wait_seconds: Math.ceil(wait / 1000), error: 'Already checked in today' });
    }

    let streak = Number(u.checkin_streak) || 0;
    if (isStreakBroken(last)) streak = 0;

    const nextDay = Math.min(streak + 1, 7);
    const cfg = await getConfig(c.env.DB);
    const rewards = cfg.checkin_day_rewards || [];
    let reward = Number(rewards[nextDay - 1]);
    if (!Number.isFinite(reward)) reward = Number(cfg.daily_checkin_reward) || 0;

    let newStreak = nextDay;
    let bonus = 0;
    // Day 7 uses day7 reward only (no separate bonus unless streak_bonus > 0)
    if (nextDay >= 7) {
      bonus = Number(cfg.streak_bonus) || 0;
      if (bonus > 0) reward = reward + bonus;
      newStreak = 0;
    }

    const nowSec = Math.floor(Date.now() / 1000);

    // Try full update; if columns missing, attempt migration then retry
    const runUpdate = async () => {
      await c.env.DB
        .prepare(
          `UPDATE users SET
            balance = balance + ?,
            total_earned = total_earned + ?,
            last_checkin_at = ?,
            checkin_streak = ?,
            checkin_total_earned = COALESCE(checkin_total_earned, 0) + ?
           WHERE id = ?`
        )
        .bind(reward, reward, nowSec, newStreak, reward, u.id)
        .run();
    };

    try {
      await runUpdate();
    } catch (colErr: any) {
      const msg = String(colErr?.message || colErr);
      if (msg.includes('checkin_streak') || msg.includes('checkin_total') || msg.includes('no such column')) {
        try {
          await c.env.DB.prepare('ALTER TABLE users ADD COLUMN checkin_streak INTEGER DEFAULT 0').run();
        } catch (_) {}
        try {
          await c.env.DB.prepare('ALTER TABLE users ADD COLUMN checkin_total_earned REAL DEFAULT 0').run();
        } catch (_) {}
        await runUpdate();
      } else {
        throw colErr;
      }
    }

    const updated = await c.env.DB.prepare('SELECT balance, checkin_streak, checkin_total_earned FROM users WHERE id = ?').bind(u.id).first<any>();

    return c.json({
      success: true,
      reward,
      streak: nextDay >= 7 ? 7 : newStreak,
      next_streak: newStreak,
      day: nextDay,
      bonus,
      streak_total: Number(updated?.checkin_total_earned ?? (Number(u.checkin_total_earned || 0) + reward)),
      balance: updated?.balance,
      last_checkin_at: nowSec,
    });
  } catch (e: any) {
    console.error('checkin error', e);
    return c.json({ error: e?.message || 'Check-in failed' }, 500);
  }
});

app.post('/api/tap', async (c) => {
  try {
    const body = await c.req.json();
    const taps = Math.max(1, Math.min(50, parseInt(body.taps || 1, 10)));
    let u = await ensureUser(c.env.DB, c.env, body.user, null);
    const energyMax = parseFloat(await getSetting(c.env.DB, 'energy_max')) || 1000;
    const cooldownSec = parseFloat(await getSetting(c.env.DB, 'energy_cooldown')) || 3600;
    const rewardPer = parseFloat(await getSetting(c.env.DB, 'tap_reward')) || 0;

    if (Number(u.energy) <= 0) {
      return c.json({
        error: 'No energy',
        energy: 0,
        energy_reset_at: u.energy_reset_at < 1e12 && u.energy_reset_at > 0 ? u.energy_reset_at * 1000 : u.energy_reset_at,
      });
    }

    const used = Math.min(taps, Number(u.energy));
    const earned = used * rewardPer;
    let newEnergy = Number(u.energy) - used;
    let resetAt = Number(u.energy_reset_at) || 0;

    if (newEnergy <= 0) {
      newEnergy = 0;
      resetAt = Math.floor(Date.now() / 1000) + cooldownSec;
    }

    await c.env.DB
      .prepare(
        `UPDATE users SET energy = ?, energy_reset_at = ?, balance = balance + ?, total_earned = total_earned + ?, total_taps = total_taps + ? WHERE id = ?`
      )
      .bind(newEnergy, resetAt, earned, earned, used, u.id)
      .run();

    return c.json({
      success: true,
      earned,
      energy: newEnergy,
      energy_reset_at: resetAt > 0 && resetAt < 1e12 ? resetAt * 1000 : resetAt,
      taps: used,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get('/api/tasks', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, title, type, link, reward FROM tasks WHERE is_active = 1 ORDER BY id DESC'
  ).all();
  return c.json({ tasks: results || [] });
});

app.post('/api/tasks/complete', async (c) => {
  try {
    const body = await c.req.json();
    const u = await ensureUser(c.env.DB, c.env, body.user, null);
    const taskId = body.task_id;
    const task = await c.env.DB
      .prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1')
      .bind(taskId)
      .first<any>();
    if (!task) return c.json({ error: 'Task not found' });
    const done = await c.env.DB
      .prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?')
      .bind(u.id, taskId)
      .first();
    if (done) return c.json({ error: 'Already completed' });
    await c.env.DB
      .prepare('INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)')
      .bind(u.id, taskId)
      .run();
    await c.env.DB
      .prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?')
      .bind(task.reward, task.reward, u.id)
      .run();
    return c.json({ success: true, reward: task.reward });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get('/api/leaderboard', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, first_name, total_earned, total_taps FROM users ORDER BY total_earned DESC LIMIT 100'
  ).all();
  return c.json({ leaderboard: results || [] });
});

app.get('/api/referrals', async (c) => c.json({ referrals: [] }));

app.post('/api/referrals', async (c) => {
  try {
    const body = await c.req.json();
    const u = await ensureUser(c.env.DB, c.env, body.user, null);
    const { results } = await c.env.DB
      .prepare(
        `SELECT r.*, u.username, u.first_name FROM referrals r
         LEFT JOIN users u ON u.id = r.referred_id
         WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT 100`
      )
      .bind(u.id)
      .all();
    return c.json({ referrals: results || [], invite_count: u.invite_count });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.post('/api/withdraw', async (c) => {
  try {
    const body = await c.req.json();
    const u = await ensureUser(c.env.DB, c.env, body.user, null);
    const amount = parseFloat(body.amount);
    const wallet = String(body.wallet_address || u.wallet_address || '').trim();
    const min = parseFloat(await getSetting(c.env.DB, 'min_withdraw')) || 1;
    if (!wallet || wallet.length < 10) return c.json({ error: 'Connect wallet first' });
    if (!amount || amount < min) return c.json({ error: `Min ${min} HYPE` });
    if (Number(u.balance) < amount) return c.json({ error: 'Insufficient balance' });
    await c.env.DB.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').bind(amount, u.id).run();
    const info = await c.env.DB
      .prepare('INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES (?, ?, ?, ?)')
      .bind(u.id, amount, wallet, 'pending')
      .run();
    return c.json({ success: true, id: info.meta.last_row_id });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});

app.get('/api/withdrawals', async (c) => c.json({ withdrawals: [] }));

app.post('/api/withdrawals', async (c) => {
  try {
    const body = await c.req.json();
    const u = await ensureUser(c.env.DB, c.env, body.user, null);
    const { results } = await c.env.DB
      .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50')
      .bind(u.id)
      .all();
    return c.json({ withdrawals: results || [] });
  } catch {
    return c.json({ withdrawals: [] });
  }
});

// ──── Admin ────
app.get('/api/admin/stats', async (c) => {
  const users = (await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<any>())?.c || 0;
  const taps = (await c.env.DB.prepare('SELECT SUM(total_taps) AS s FROM users').first<any>())?.s || 0;
  const earned = (await c.env.DB.prepare('SELECT SUM(total_earned) AS s FROM users').first<any>())?.s || 0;
  const pending =
    (await c.env.DB.prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'").first<any>())?.c || 0;
  return c.json({ users, taps, earned, pending_withdrawals: pending });
});

app.get('/api/admin/withdrawals', async (c) => {
  const status = c.req.query('status') || 'pending';
  const { results } = await c.env.DB
    .prepare(
      `SELECT w.*, u.username, u.first_name FROM withdrawals w
       LEFT JOIN users u ON u.id = w.user_id
       WHERE w.status = ? ORDER BY w.id DESC LIMIT 100`
    )
    .bind(status)
    .all();
  return c.json({ withdrawals: results || [] });
});

app.post('/api/admin/withdrawals/:id', async (c) => {
  const action = (await c.req.json()).action;
  const status = action === 'approve' ? 'approved' : 'rejected';
  const id = c.req.param('id');
  if (status === 'rejected') {
    const w = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first<any>();
    if (w && w.status === 'pending') {
      await c.env.DB.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(w.amount, w.user_id).run();
    }
  }
  await c.env.DB
    .prepare("UPDATE withdrawals SET status = ?, processed_at = strftime('%s','now') WHERE id = ?")
    .bind(status, id)
    .run();
  return c.json({ success: true });
});

app.get('/api/admin/tasks', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  return c.json({ tasks: results || [] });
});

app.post('/api/admin/tasks', async (c) => {
  const b = await c.req.json();
  const info = await c.env.DB
    .prepare('INSERT INTO tasks (title, type, link, reward) VALUES (?, ?, ?, ?)')
    .bind(b.title, b.type || 'telegram', b.link || '', parseFloat(b.reward) || 0)
    .run();
  return c.json({ success: true, id: info.meta.last_row_id });
});

app.delete('/api/admin/tasks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

app.get('/api/admin/settings', async (c) => c.json(await getConfig(c.env.DB)));

app.post('/api/admin/settings', async (c) => {
  const b = await c.req.json();
  const keys = [
    'tap_reward',
    'referral_reward',
    'min_withdraw',
    'energy_max',
    'energy_cooldown',
    'daily_checkin_reward',
    'streak_bonus',
  ] as const;
  for (const k of keys) {
    if (b[k] !== undefined && b[k] !== null && b[k] !== '') {
      await setSetting(c.env.DB, k, String(b[k]));
    }
  }
  if (Array.isArray(b.checkin_day_rewards)) {
    await setSetting(c.env.DB, 'checkin_day_rewards', JSON.stringify(b.checkin_day_rewards.map(Number)));
  }
  return c.json({ success: true, settings: await getConfig(c.env.DB) });
});

app.get('/api/admin/leaderboard', async (c) => {
  const limit = Math.min(100, parseInt(c.req.query('limit') || '50', 10));
  const { results } = await c.env.DB
    .prepare(
      'SELECT id, username, first_name, balance, total_earned, total_taps, invite_count FROM users ORDER BY total_earned DESC LIMIT ?'
    )
    .bind(limit)
    .all();
  return c.json({ leaderboard: results || [] });
});

app.get('/api/admin/referrals', async (c) => {
  const limit = Math.min(100, parseInt(c.req.query('limit') || '50', 10));
  const { results } = await c.env.DB.prepare('SELECT * FROM referrals ORDER BY id DESC LIMIT ?').bind(limit).all();
  return c.json({ referrals: results || [] });
});

app.get('/api/admin/users/:id', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!u) return c.json({ error: 'Not found' });
  return c.json({ user: publicUser(u, c.env) });
});

app.post('/api/admin/users/:id', async (c) => {
  const b = await c.req.json();
  const id = c.req.param('id');
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
  if (!u) return c.json({ error: 'Not found' });
  await c.env.DB
    .prepare(
      `UPDATE users SET
        balance = COALESCE(?, balance),
        total_earned = COALESCE(?, total_earned),
        total_taps = COALESCE(?, total_taps),
        is_admin = COALESCE(?, is_admin),
        invite_count = COALESCE(?, invite_count)
       WHERE id = ?`
    )
    .bind(
      b.balance != null ? parseFloat(b.balance) : null,
      b.total_earned != null ? parseFloat(b.total_earned) : null,
      b.total_taps != null ? parseInt(b.total_taps, 10) : null,
      b.is_admin != null ? (b.is_admin ? 1 : 0) : null,
      b.invite_count != null ? parseInt(b.invite_count, 10) : null,
      id
    )
    .run();
  return c.json({ success: true });
});

app.delete('/api/admin/users/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

app.post('/api/admin/broadcast', async (c) => {
  return c.json({ success: true, sent: 0, message: 'Wire Telegram bot token for broadcast' });
});

// Serve Vite SPA from frontend/dist (Workers Assets)
app.all('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text(
    '404 — Frontend assets missing. Run: cd frontend && npm run build  then wrangler deploy',
    404
  );
});

export default app;

