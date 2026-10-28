import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCookie, setCookie } from 'hono/cookie';

type Env = {
  DB: D1Database;
  BOT_TOKEN: string;
  ADMIN_ID: string;
  BOT_USERNAME: string;
  MIN_WITHDRAW: string;
  TAP_REWARD: string;
  REFERRAL_REWARD: string;
  ENERGY_MAX: string;
  ENERGY_COOLDOWN_SEC: string;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Telegram-Init-Data'],
}));

// ========== Helpers ==========
function parseInitData(initData: string, botToken: string): any | null {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    // In production use Web Crypto to verify HMAC-SHA256
    // For simplicity we trust Telegram WebApp in this scaffold (add proper verify later)
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

async function getUser(db: D1Database, id: number) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

async function getSetting(db: D1Database, key: string, fallback: number): Promise<number> {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first() as any;
    return row ? parseFloat(row.value) : fallback;
  } catch { return fallback; }
}

async function getAllSettings(db: D1Database, env: Env) {
  return {
    tap_reward: await getSetting(db, "tap_reward", parseFloat(env.TAP_REWARD) || 0.0000000695),
    referral_reward: await getSetting(db, "referral_reward", parseFloat(env.REFERRAL_REWARD) || 0.00008526),
    min_withdraw: await getSetting(db, "min_withdraw", parseFloat(env.MIN_WITHDRAW) || 2),
    energy_max: await getSetting(db, "energy_max", parseFloat(env.ENERGY_MAX) || 1000),
    energy_cooldown: await getSetting(db, "energy_cooldown", parseFloat(env.ENERGY_COOLDOWN_SEC) || 3600),
    daily_checkin_reward: await getSetting(db, "daily_checkin_reward", 0.001),
  };
}

async function ensureUser(db: D1Database, tgUser: any, referredBy: number | null, env: Env) {
  let user = await getUser(db, tgUser.id);
  if (user) {
    await db.prepare(
      `UPDATE users SET username=?, first_name=?, last_name=?, last_active=strftime('%s','now') WHERE id=?`
    ).bind(tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.id).run();
    return user;
  }

  // New user
  const isAdmin = String(tgUser.id) === env.ADMIN_ID ? 1 : 0;
  await db.prepare(
    `INSERT INTO users (id, username, first_name, last_name, is_admin, referred_by, energy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    tgUser.id,
    tgUser.username || null,
    tgUser.first_name || null,
    tgUser.last_name || null,
    isAdmin,
    referredBy,
    (await getAllSettings(db, env)).energy_max
  ).run();

  // Referral reward
  if (referredBy && referredBy !== tgUser.id) {
    const refReward = (await getAllSettings(db, env)).referral_reward;
    await db.prepare(
      `UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?`
    ).bind(refReward, refReward, referredBy).run();

    await db.prepare(
      `INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)`
    ).bind(referredBy, tgUser.id, refReward).run();

    // Notify referrer via bot
    const referrer = await getUser(db, referredBy);
    if (referrer) {
      await sendTelegramMessage(env.BOT_TOKEN, referredBy,
        `🎉 You invited successfully!\n\nUser: @${tgUser.username || tgUser.first_name || tgUser.id}\nReward: +${refReward} HYPE`);
    }
  }

  return await getUser(db, tgUser.id);
}

async function sendTelegramMessage(token: string, chatId: number | string, text: string, extra: any = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...extra
      })
    });
    return await res.json();
  } catch (e) {
    console.error('TG send error', e);
    return null;
  }
}

async function sendTelegramPhoto(token: string, chatId: number | string, photo: string, caption: string = '', extra: any = {}) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo,
        caption: caption || undefined,
        parse_mode: 'HTML',
        ...extra
      })
    });
    return await res.json();
  } catch (e) {
    console.error('TG photo send error', e);
    return null;
  }
}

function now() {
  return Math.floor(Date.now() / 1000);
}

// ========== Auth middleware helper ==========
async function getAuthUser(c: any) {
  const initData = c.req.header('X-Telegram-Init-Data') || '';
  const user = parseInitData(initData, c.env.BOT_TOKEN);
  if (!user || !user.id) return null;
  return user;
}

// ========== API Routes ==========

// Health
app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

// Get / create user + current state
app.post('/api/user', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const startParam = body.start_param || body.referrer_id || null;
  let referredBy: number | null = null;
  if (startParam) {
    const n = parseInt(String(startParam).replace(/\D/g, ''));
    if (!isNaN(n) && n > 0) referredBy = n;
  }

  const user = await ensureUser(c.env.DB, tgUser, referredBy, c.env);
  if (!user) return c.json({ error: 'Failed to create user' }, 500);

  // Refresh energy if cooldown passed
  const settings = await getAllSettings(c.env.DB, c.env);
  const energyMax = settings.energy_max;
  let energy = user.energy as number;
  let energyResetAt = user.energy_reset_at as number;
  const t = now();

  if (energy <= 0 && energyResetAt > 0 && t >= energyResetAt) {
    energy = energyMax;
    energyResetAt = 0;
    await c.env.DB.prepare(
      `UPDATE users SET energy = ?, energy_reset_at = 0 WHERE id = ?`
    ).bind(energy, user.id).run();
  }

  // Price
  let price = 0;
  try {
    const priceRes = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' })
    });
    const mids = await priceRes.json() as Record<string, string>;
    price = parseFloat(mids['HYPE'] || mids['@1'] || '0') || 0;
  } catch {}

  // Daily check-in status (UTC day)
  const lastCheckin = (user as any).last_checkin_at || 0;
  const todayStart = Math.floor(Date.now() / 1000);
  const lastDay = Math.floor(lastCheckin / 86400);
  const todayDay = Math.floor(todayStart / 86400);
  const canCheckin = lastDay < todayDay;

  return c.json({
    user: {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      balance: user.balance,
      total_earned: user.total_earned,
      energy,
      energy_reset_at: energyResetAt,
      invite_count: user.invite_count,
      total_taps: user.total_taps,
      is_admin: !!user.is_admin,
      wallet_address: user.wallet_address,
      last_checkin_at: lastCheckin,
      can_checkin: canCheckin,
    },
    price,
    config: {
      tap_reward: settings.tap_reward,
      referral_reward: settings.referral_reward,
      min_withdraw: settings.min_withdraw,
      energy_max: energyMax,
      energy_cooldown: settings.energy_cooldown,
      daily_checkin_reward: settings.daily_checkin_reward,
      bot_username: c.env.BOT_USERNAME
    }
  });
});

// Tap
app.post('/api/tap', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const taps = Math.min(Math.max(parseInt(body.taps) || 1, 1), 50); // anti-spam batch
  const user = await getUser(c.env.DB, tgUser.id);
  if (!user) return c.json({ error: 'User not found' }, 404);

  let energy = user.energy as number;
  let energyResetAt = user.energy_reset_at as number;
  const t = now();
  const settings = await getAllSettings(c.env.DB, c.env);
  const energyMax = settings.energy_max;
  const cooldown = settings.energy_cooldown;
  const rewardPerTap = settings.tap_reward;

  // Recharge check
  if (energy <= 0) {
    if (energyResetAt > 0 && t >= energyResetAt) {
      energy = energyMax;
      energyResetAt = 0;
    } else {
      return c.json({
        error: 'Energy depleted',
        energy: 0,
        energy_reset_at: energyResetAt,
        wait_seconds: Math.max(0, energyResetAt - t)
      }, 429);
    }
  }

  const actualTaps = Math.min(taps, energy);
  const earned = actualTaps * rewardPerTap;
  energy -= actualTaps;

  if (energy <= 0) {
    energy = 0;
    energyResetAt = t + cooldown;
  }

  await c.env.DB.prepare(
    `UPDATE users SET 
      balance = balance + ?, 
      total_earned = total_earned + ?, 
      energy = ?, 
      energy_reset_at = ?,
      total_taps = total_taps + ?,
      last_active = ?
     WHERE id = ?`
  ).bind(earned, earned, energy, energyResetAt, actualTaps, t, tgUser.id).run();

  return c.json({
    success: true,
    earned,
    taps: actualTaps,
    energy,
    energy_reset_at: energyResetAt,
    balance: (user.balance as number) + earned
  });
});

// Daily Check-in
app.post('/api/checkin', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const user = await getUser(c.env.DB, tgUser.id);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const settings = await getAllSettings(c.env.DB, c.env);
  const reward = settings.daily_checkin_reward;
  const lastCheckin = (user as any).last_checkin_at || 0;
  const nowTs = Math.floor(Date.now() / 1000);
  const lastDay = Math.floor(lastCheckin / 86400);
  const todayDay = Math.floor(nowTs / 86400);

  if (lastDay >= todayDay) {
    const nextReset = (todayDay + 1) * 86400;
    const waitSec = Math.max(0, nextReset - nowTs);
    return c.json({
      error: 'Already checked in today',
      already: true,
      wait_seconds: waitSec,
      next_checkin_at: nextReset,
    }, 429);
  }

  await c.env.DB.prepare(
    `UPDATE users SET 
      balance = balance + ?, 
      total_earned = total_earned + ?, 
      last_checkin_at = ?,
      last_active = ?
     WHERE id = ?`
  ).bind(reward, reward, nowTs, nowTs, tgUser.id).run();

  return c.json({
    success: true,
    reward,
    balance: (user.balance as number) + reward,
    last_checkin_at: nowTs,
  });
});

// Leaderboard
app.get('/api/leaderboard', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, username, first_name, balance, total_earned, total_taps, invite_count
     FROM users ORDER BY total_earned DESC LIMIT ?`
  ).bind(limit).all();

  return c.json({ leaderboard: rows.results || [] });
});

// Tasks list
app.get('/api/tasks', async (c) => {
  const tgUser = await getAuthUser(c);
  const userId = tgUser?.id;

  const tasks = await c.env.DB.prepare(
    `SELECT * FROM tasks WHERE is_active = 1 ORDER BY id DESC`
  ).all();

  let completed: any[] = [];
  if (userId) {
    const res = await c.env.DB.prepare(
      `SELECT task_id FROM user_tasks WHERE user_id = ?`
    ).bind(userId).all();
    completed = (res.results || []).map((r: any) => r.task_id);
  }

  return c.json({
    tasks: tasks.results || [],
    completed
  });
});

// Complete task
app.post('/api/tasks/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const taskId = body.task_id;
  if (!taskId) return c.json({ error: 'task_id required' }, 400);

  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').bind(taskId).first();
  if (!task) return c.json({ error: 'Task not found' }, 404);

  // Check already done
  const exists = await c.env.DB.prepare(
    'SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?'
  ).bind(tgUser.id, taskId).first();
  if (exists) return c.json({ error: 'Already completed' }, 400);

  await c.env.DB.prepare(
    'INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)'
  ).bind(tgUser.id, taskId).run();

  await c.env.DB.prepare(
    `UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?`
  ).bind(task.reward, task.reward, tgUser.id).run();

  return c.json({ success: true, reward: task.reward });
});

// Withdraw request
app.post('/api/withdraw', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const amount = parseFloat(body.amount);
  const wallet = (body.wallet_address || '').trim();
  const minW = parseFloat(c.env.MIN_WITHDRAW);

  if (!wallet || wallet.length < 10) return c.json({ error: 'Invalid wallet address' }, 400);
  if (isNaN(amount) || amount < minW) return c.json({ error: `Minimum withdrawal is ${minW} HYPE` }, 400);

  const user = await getUser(c.env.DB, tgUser.id);
  if (!user) return c.json({ error: 'User not found' }, 404);
  if ((user.balance as number) < amount) return c.json({ error: 'Insufficient balance' }, 400);

  // Deduct + create request
  await c.env.DB.prepare(
    `UPDATE users SET balance = balance - ?, wallet_address = ? WHERE id = ?`
  ).bind(amount, wallet, tgUser.id).run();

  const res = await c.env.DB.prepare(
    `INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES (?, ?, ?, 'pending')`
  ).bind(tgUser.id, amount, wallet).run();

  // Notify admin
  await sendTelegramMessage(c.env.BOT_TOKEN, c.env.ADMIN_ID,
    `💸 New Withdrawal Request\n\nUser: @${user.username || tgUser.id}\nAmount: ${amount} HYPE\nWallet: <code>${wallet}</code>\nID: ${res.meta.last_row_id}`);

  return c.json({ success: true, message: 'Withdrawal request submitted. Waiting for admin approval.' });
});

// User withdrawals history
app.get('/api/withdrawals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(tgUser.id).all();

  return c.json({ withdrawals: rows.results || [] });
});

// ========== ADMIN ROUTES ==========
function requireAdmin(c: any, user: any) {
  if (!user || String(user.id) !== c.env.ADMIN_ID) {
    return false;
  }
  return true;
}

app.get('/api/admin/stats', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);

  const users = await c.env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
  const pending = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'`).first();
  const totalBal = await c.env.DB.prepare('SELECT SUM(balance) as s FROM users').first();
  const totalEarned = await c.env.DB.prepare('SELECT SUM(total_earned) as s FROM users').first();

  return c.json({
    total_users: users?.c || 0,
    pending_withdrawals: pending?.c || 0,
    total_balance: totalBal?.s || 0,
    total_earned: totalEarned?.s || 0
  });
});

app.get('/api/admin/withdrawals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);

  const status = c.req.query('status') || 'pending';
  const rows = await c.env.DB.prepare(
    `SELECT w.*, u.username, u.first_name 
     FROM withdrawals w LEFT JOIN users u ON w.user_id = u.id 
     WHERE w.status = ? ORDER BY w.created_at DESC LIMIT 100`
  ).bind(status).all();

  return c.json({ withdrawals: rows.results || [] });
});

app.post('/api/admin/withdrawals/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);

  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const action = body.action; // approve | reject | processing
  const note = body.note || '';

  if (!['approve', 'reject', 'processing'].includes(action)) {
    return c.json({ error: 'Invalid action' }, 400);
  }

  const statusMap: any = { approve: 'approved', reject: 'rejected', processing: 'processing' };
  const newStatus = statusMap[action];

  const wd = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first();
  if (!wd) return c.json({ error: 'Not found' }, 404);

  if (action === 'reject' && wd.status === 'pending') {
    // Refund
    await c.env.DB.prepare(
      `UPDATE users SET balance = balance + ? WHERE id = ?`
    ).bind(wd.amount, wd.user_id).run();
  }

  await c.env.DB.prepare(
    `UPDATE withdrawals SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?`
  ).bind(newStatus, note, now(), id).run();

  // Notify user
  const msg = action === 'approve'
    ? `✅ Your withdrawal of ${wd.amount} HYPE has been approved and sent!`
    : action === 'reject'
    ? `❌ Your withdrawal of ${wd.amount} HYPE was rejected.${note ? '\nReason: ' + note : ''}\nAmount refunded to balance.`
    : `⏳ Your withdrawal of ${wd.amount} HYPE is now being processed.`;

  await sendTelegramMessage(c.env.BOT_TOKEN, wd.user_id as number, msg);

  return c.json({ success: true });
});

// Admin tasks CRUD
app.get('/api/admin/tasks', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await c.env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
  return c.json({ tasks: rows.results || [] });
});

app.post('/api/admin/tasks', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const { title, type, link, reward } = body;
  if (!title || !type || !link) return c.json({ error: 'Missing fields' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO tasks (title, type, link, reward, is_active) VALUES (?, ?, ?, ?, 1)`
  ).bind(title, type, link, parseFloat(reward) || 0.0085).run();

  return c.json({ success: true });
});

app.delete('/api/admin/tasks/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// Broadcast (text and/or photo)
app.post('/api/admin/broadcast', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json().catch(() => ({}));
  const message = (body.message || body.caption || '').trim();
  const photo = (body.photo || body.photo_url || '').trim();
  if (!message && !photo) return c.json({ error: 'Message or photo required' }, 400);

  // Get all user ids (limit for safety)
  const users = await c.env.DB.prepare('SELECT id FROM users ORDER BY last_active DESC LIMIT 5000').all();
  let success = 0;
  let failed = 0;
  for (const u of (users.results || [])) {
    let r: any = null;
    if (photo) {
      // Photo with optional caption (Telegram caption max 1024)
      const caption = message ? message.slice(0, 1024) : '';
      r = await sendTelegramPhoto(c.env.BOT_TOKEN, (u as any).id, photo, caption);
    } else {
      r = await sendTelegramMessage(c.env.BOT_TOKEN, (u as any).id, message);
    }
    if (r && r.ok) success++;
    else failed++;
    // small delay to avoid rate limit (~30 msg/sec)
    await new Promise(r => setTimeout(r, 35));
  }

  const logMsg = photo ? `[PHOTO] ${photo}\n${message}` : message;
  await c.env.DB.prepare(
    `INSERT INTO broadcasts (message, sent_by, success_count) VALUES (?, ?, ?)`
  ).bind(logMsg.slice(0, 4000), tgUser.id, success).run();

  return c.json({ success: true, sent: success, failed, total: (users.results || []).length });
});

// Referrals of a user
app.get('/api/referrals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT r.*, u.username, u.first_name 
     FROM referrals r LEFT JOIN users u ON r.referred_id = u.id 
     WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 100`
  ).bind(tgUser.id).all();

  return c.json({ referrals: rows.results || [] });
});

// ===== NEW: Admin task update =====
app.patch('/api/admin/tasks/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first() as any;
  if (!task) return c.json({ error: 'Task not found' }, 404);
  const updates: string[] = [];
  const values: any[] = [];
  if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title); }
  if (body.type !== undefined) { updates.push('type = ?'); values.push(body.type); }
  if (body.link !== undefined) { updates.push('link = ?'); values.push(body.link); }
  if (body.reward !== undefined) { updates.push('reward = ?'); values.push(parseFloat(body.reward)); }
  if (body.is_active !== undefined) { updates.push('is_active = ?'); values.push(body.is_active ? 1 : 0); }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const updated = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return c.json({ success: true, task: updated });
});

// ===== NEW: Admin leaderboard =====
app.get('/api/admin/leaderboard', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  const offset = parseInt(c.req.query('offset') || '0');
  const rows = await c.env.DB.prepare(
    `SELECT id, username, first_name, balance, total_earned, total_taps, invite_count, referred_by, is_admin, last_active, created_at FROM users ORDER BY total_earned DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM users').first() as any;
  return c.json({ leaderboard: rows.results || [], total: countRow?.total || 0, limit, offset });
});

// ===== NEW: Admin user details =====
app.get('/api/admin/users/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'));
  const user = await getUser(c.env.DB, id);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const tasks = await c.env.DB.prepare(
    'SELECT t.id, t.title, ut.completed_at FROM user_tasks ut JOIN tasks t ON ut.task_id = t.id WHERE ut.user_id = ? ORDER BY ut.completed_at DESC'
  ).bind(id).all();
  return c.json({ user, completed_tasks: tasks.results || [] });
});

// ===== NEW: Admin update user =====
app.post('/api/admin/users/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const user = await getUser(c.env.DB, id);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const updates: string[] = [];
  const values: any[] = [];
  if (body.balance !== undefined) { updates.push('balance = ?'); values.push(parseFloat(body.balance)); }
  if (body.total_earned !== undefined) { updates.push('total_earned = ?'); values.push(parseFloat(body.total_earned)); }
  if (body.total_taps !== undefined) { updates.push('total_taps = ?'); values.push(parseInt(body.total_taps)); }
  if (body.is_admin !== undefined) { updates.push('is_admin = ?'); values.push(body.is_admin ? 1 : 0); }
  if (body.invite_count !== undefined) { updates.push('invite_count = ?'); values.push(parseInt(body.invite_count)); }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const updated = await getUser(c.env.DB, id);
  return c.json({ success: true, user: updated });
});

// ===== NEW: Admin delete user =====
app.delete('/api/admin/users/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM user_tasks WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').bind(id, id).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ===== NEW: Admin get settings =====
app.get('/api/admin/settings', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const settings = await getAllSettings(c.env.DB, c.env);
  return c.json(settings);
});

// ===== NEW: Admin update settings =====
app.post('/api/admin/settings', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const allowed = ['tap_reward', 'referral_reward', 'min_withdraw', 'energy_max', 'energy_cooldown', 'daily_checkin_reward'];
  for (const key of allowed) {
    if (body[key] !== undefined && body[key] !== null) {
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
      ).bind(key, String(body[key]), Math.floor(Date.now() / 1000)).run();
    }
  }
  const settings = await getAllSettings(c.env.DB, c.env);
  return c.json({ success: true, settings });
});

// ===== NEW: Admin referrals list =====
app.get('/api/admin/referrals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, u1.username as referrer_name, u2.username as referred_name FROM referrals r LEFT JOIN users u1 ON r.referrer_id = u1.id LEFT JOIN users u2 ON r.referred_id = u2.id ORDER BY r.id DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ referrals: rows.results || [] });
});

// Serve frontend (assets)
app.get('*', async (c) => {
  // Try to serve from assets binding if available
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Frontend not built. Run npm run build:frontend', 404);
});

export default app;
