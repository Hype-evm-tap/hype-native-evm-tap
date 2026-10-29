import { Hono } from 'hono';
import { cors } from 'hono/cors';

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
    const userStr = params.get('user');
    if (!userStr) return null;
    const parsedUser = JSON.parse(userStr);
    try { parsedUser.start_param = params.get('start_param') || null; } catch {}
    return parsedUser;
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
    daily_checkin_reward: await getSetting(db, "daily_checkin_reward", 0.0000005678),
  };
}

// Apply referral: set referred_by, give reward, insert into referrals table (idempotent)
async function applyReferral(db: D1Database, referredId: number, referredBy: number, tgUser: any, settings: any, env: Env) {
  if (!referredBy || referredBy === referredId) return false;
  const existing = await db.prepare(
    `SELECT id FROM referrals WHERE referred_id = ?`
  ).bind(referredId).first();
  if (existing) return false;
  const referrer = await getUser(db, referredBy);
  if (!referrer) return false;
  const refReward = settings.referral_reward || 0;
  await db.prepare(`UPDATE users SET referred_by = ? WHERE id = ? AND (referred_by IS NULL OR referred_by = 0)`)
    .bind(referredBy, referredId).run();
  await db.prepare(
    `UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?`
  ).bind(refReward, refReward, referredBy).run();
  await db.prepare(
    `INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)`
  ).bind(referredBy, referredId, refReward).run();
  try {
    await sendTelegramMessage(env.BOT_TOKEN, referredBy,
      `🎉 You invited successfully!\n\nUser: @${tgUser?.username || tgUser?.first_name || referredId}\nReward: +${refReward} HYPE`);
  } catch {}
  return true;
}

async function ensureUser(db: D1Database, tgUser: any, referredBy: number | null, env: Env) {
  let user = await getUser(db, tgUser.id);
  const settings = await getAllSettings(db, env);
  if (user) {
    await db.prepare(
      `UPDATE users SET username=?, first_name=?, last_name=?, last_active=strftime('%s','now') WHERE id=?`
    ).bind(tgUser.username || null, tgUser.first_name || null, tgUser.last_name || null, tgUser.id).run();
    if (referredBy && referredBy !== tgUser.id) {
      await applyReferral(db, tgUser.id, referredBy, tgUser, settings, env);
    }
    return await getUser(db, tgUser.id);
  }
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
    (referredBy && referredBy !== tgUser.id) ? referredBy : null,
    settings.energy_max
  ).run();
  if (referredBy && referredBy !== tgUser.id) {
    await applyReferral(db, tgUser.id, referredBy, tgUser, settings, env);
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

async function getAuthUser(c: any) {
  const initData = c.req.header('X-Telegram-Init-Data') || '';
  const user = parseInitData(initData, c.env.BOT_TOKEN);
  if (!user || !user.id) return null;
  return user;
}

// ========== API Routes ==========
app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/price', async (c) => {
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
  return c.json({ symbol: 'HYPE', price, timestamp: Math.floor(Date.now() / 1000) });
});

app.post('/api/user', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  let startParam =
    body.start_param ||
    body.referrer_id ||
    body.ref ||
    tgUser.start_param ||
    null;
  if (!startParam) {
    try {
      const initData = c.req.header('X-Telegram-Init-Data') || '';
      const params = new URLSearchParams(initData);
      startParam = params.get('start_param') || params.get('start') || null;
    } catch {}
  }
  if (!startParam) {
    try {
      const url = new URL(c.req.url);
      startParam = url.searchParams.get('start_param') || url.searchParams.get('start') || url.searchParams.get('ref') || null;
    } catch {}
  }

  let referredBy: number | null = null;
  if (startParam) {
    const n = parseInt(String(startParam).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > 0 && n !== tgUser.id) referredBy = n;
  }

  const user = await ensureUser(c.env.DB, tgUser, referredBy, c.env);
  if (!user) return c.json({ error: 'Failed to create user' }, 500);

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

  const lastCheckin = (user as any).last_checkin_at || 0;
  const todayStart = Math.floor(Date.now() / 1000);
  const canCheckin = lastCheckin === 0 || (todayStart - lastCheckin) >= 86400;

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

app.post('/api/tap', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const taps = Math.min(Math.max(parseInt(body.taps) || 1, 1), 50);
  const user = await getUser(c.env.DB, tgUser.id);
  if (!user) return c.json({ error: 'User not found' }, 404);

  let energy = user.energy as number;
  let energyResetAt = user.energy_reset_at as number;
  const t = now();
  const settings = await getAllSettings(c.env.DB, c.env);
  const energyMax = settings.energy_max;
  const cooldown = settings.energy_cooldown;
  const rewardPerTap = settings.tap_reward;

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
  const CHECKIN_GAP = 86400;

  if (lastCheckin > 0 && nowTs - lastCheckin < CHECKIN_GAP) {
    const nextCheckin = lastCheckin + CHECKIN_GAP;
    const waitSec = Math.max(0, nextCheckin - nowTs);
    return c.json({
      error: 'Already checked in. Next check-in available in 24 hours.',
      already: true,
      wait_seconds: waitSec,
      next_checkin_at: nextCheckin,
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

app.get('/api/leaderboard', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 100);
  const rows = await c.env.DB.prepare(
    `SELECT id, username, first_name, balance, total_earned, total_taps, invite_count
     FROM users ORDER BY total_earned DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ leaderboard: rows.results || [] });
});

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

app.post('/api/tasks/complete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);
  const taskId = body.task_id;
  if (!taskId) return c.json({ error: 'task_id required' }, 400);

  const task = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').bind(taskId).first();
  if (!task) return c.json({ error: 'Task not found' }, 404);

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

app.post('/api/withdraw', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tgUser = body.user || await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);

  const amount = parseFloat(body.amount);
  const wallet = (body.wallet_address || '').trim();
  const settings = await getAllSettings(c.env.DB, c.env);
  const minW = settings.min_withdraw;

  if (!wallet || wallet.length < 10) return c.json({ error: 'Invalid wallet address' }, 400);
  if (isNaN(amount) || amount < minW) return c.json({ error: `Minimum withdrawal is ${minW} HYPE` }, 400);

  const user = await getUser(c.env.DB, tgUser.id);
  if (!user) return c.json({ error: 'User not found' }, 404);
  if ((user.balance as number) < amount) return c.json({ error: 'Insufficient balance' }, 400);

  const res = await c.env.DB.prepare(
    `INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES (?, ?, ?, 'pending')`
  ).bind(tgUser.id, amount, wallet).run();

  await c.env.DB.prepare(
    `UPDATE users SET balance = balance - ?, wallet_address = ? WHERE id = ?`
  ).bind(amount, wallet, tgUser.id).run();

  await sendTelegramMessage(c.env.BOT_TOKEN, c.env.ADMIN_ID,
    `💸 New Withdrawal Request\n\nUser: @${user.username || tgUser.id}\nAmount: ${amount} HYPE\nWallet: <code>${wallet}</code>\nID: ${res.meta.last_row_id}`);

  return c.json({ success: true, message: 'Withdrawal request submitted. Waiting for admin approval.' });
});

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
  const action = body.action;
  const note = body.note || '';
  if (!['approve', 'reject', 'processing'].includes(action)) {
    return c.json({ error: 'Invalid action' }, 400);
  }
  const statusMap: any = { approve: 'approved', reject: 'rejected', processing: 'processing' };
  const newStatus = statusMap[action];
  const wd = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(id).first();
  if (!wd) return c.json({ error: 'Not found' }, 404);
  if (action === 'reject' && wd.status === 'pending') {
    await c.env.DB.prepare(
      `UPDATE users SET balance = balance + ? WHERE id = ?`
    ).bind(wd.amount, wd.user_id).run();
  }
  await c.env.DB.prepare(
    `UPDATE withdrawals SET status = ?, admin_note = ?, processed_at = ? WHERE id = ?`
  ).bind(newStatus, note, now(), id).run();
  const msg = action === 'approve'
    ? `✅ Your withdrawal of ${wd.amount} HYPE has been approved and sent!`
    : action === 'reject'
    ? `❌ Your withdrawal of ${wd.amount} HYPE was rejected.${note ? '\nReason: ' + note : ''}\nAmount refunded to balance.`
    : `⏳ Your withdrawal of ${wd.amount} HYPE is now being processed.`;
  await sendTelegramMessage(c.env.BOT_TOKEN, wd.user_id as number, msg);
  return c.json({ success: true });
});

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
  await c.env.DB.prepare('DELETE FROM user_tasks WHERE task_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

app.post('/api/admin/broadcast', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const body = await c.req.json().catch(() => ({}));
  const message = (body.message || body.caption || '').trim();
  const photo = (body.photo || body.photo_url || '').trim();
  if (!message && !photo) return c.json({ error: 'Message or photo required' }, 400);

  const users = await c.env.DB.prepare('SELECT id FROM users ORDER BY last_active DESC LIMIT 5000').all();
  let success = 0;
  let failed = 0;
  for (const u of (users.results || [])) {
    let r: any = null;
    if (photo) {
      const caption = message ? message.slice(0, 1024) : '';
      r = await sendTelegramPhoto(c.env.BOT_TOKEN, (u as any).id, photo, caption);
    } else {
      r = await sendTelegramMessage(c.env.BOT_TOKEN, (u as any).id, message);
    }
    if (r && r.ok) success++;
    else failed++;
    await new Promise(r => setTimeout(r, 35));
  }
  const logMsg = photo ? `[PHOTO] ${photo}\n${message}` : message;
  await c.env.DB.prepare(
    `INSERT INTO broadcasts (message, sent_by, success_count) VALUES (?, ?, ?)`
  ).bind(logMsg.slice(0, 4000), tgUser.id, success).run();
  return c.json({ success: true, sent: success, failed, total: (users.results || []).length });
});

app.get('/api/referrals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!tgUser?.id) return c.json({ error: 'Unauthorized' }, 401);
  const settings = await getAllSettings(c.env.DB, c.env);
  const refReward = settings.referral_reward || 0;

  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.referrer_id, r.referred_id, r.reward, r.created_at,
            u.username, u.first_name, u.total_earned, u.total_taps
     FROM referrals r
     LEFT JOIN users u ON r.referred_id = u.id
     WHERE r.referrer_id = ?
     ORDER BY r.created_at DESC LIMIT 200`
  ).bind(tgUser.id).all();

  const fromTable = (rows.results || []) as any[];
  const seenIds = new Set(fromTable.map((r: any) => r.referred_id));

  const orphans = await c.env.DB.prepare(
    `SELECT id, username, first_name, total_earned, total_taps, created_at
     FROM users WHERE referred_by = ? LIMIT 200`
  ).bind(tgUser.id).all();

  for (const u of (orphans.results || []) as any[]) {
    if (seenIds.has(u.id)) continue;
    const exists = await c.env.DB.prepare(
      `SELECT id FROM referrals WHERE referred_id = ?`
    ).bind(u.id).first();
    if (!exists) {
      await c.env.DB.prepare(
        `INSERT OR IGNORE INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)`
      ).bind(tgUser.id, u.id, refReward).run();
      await c.env.DB.prepare(
        `UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?`
      ).bind(refReward, refReward, tgUser.id).run();
    }
    fromTable.push({
      id: null,
      referrer_id: tgUser.id,
      referred_id: u.id,
      reward: refReward,
      created_at: u.created_at,
      username: u.username,
      first_name: u.first_name,
      total_earned: u.total_earned,
      total_taps: u.total_taps,
    });
    seenIds.add(u.id);
  }

  const realCount = fromTable.length;
  await c.env.DB.prepare(
    `UPDATE users SET invite_count = ? WHERE id = ?`
  ).bind(realCount, tgUser.id).run();

  return c.json({ referrals: fromTable, count: realCount });
});

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

app.get('/api/admin/users', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const offset = parseInt(c.req.query('offset') || '0');
  const rows = await c.env.DB.prepare(
    `SELECT id, username, first_name, balance, total_earned, total_taps, invite_count, is_admin, referred_by, last_active, created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const total = await c.env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
  return c.json({ users: rows.results || [], total: total?.c || 0 });
});

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

app.delete('/api/admin/users/:id', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM user_tasks WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').bind(id, id).run();
  await c.env.DB.prepare('DELETE FROM withdrawals WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

app.get('/api/admin/settings', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const settings = await getAllSettings(c.env.DB, c.env);
  return c.json(settings);
});

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

app.get('/api/admin/referrals', async (c) => {
  const tgUser = await getAuthUser(c);
  if (!requireAdmin(c, tgUser)) return c.json({ error: 'Forbidden' }, 403);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, u1.username as referrer_name, u2.username as referred_name FROM referrals r LEFT JOIN users u1 ON r.referrer_id = u1.id LEFT JOIN users u2 ON r.referred_id = u2.id ORDER BY r.id DESC LIMIT ?`
  ).bind(limit).all();
  return c.json({ referrals: rows.results || [] });
});

// Serve frontend (assets) + loading screen
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    const url = new URL(c.req.url);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const res = await c.env.ASSETS.fetch(c.req.raw);
      const html = await res.text();
      const loadingCSS = '<style>#loading-screen{position:fixed;top:0;left:0;right:0;bottom:0;background:#0a0e14;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;transition:opacity .5s ease;font-family:system-ui,-apple-system,sans-serif}#loading-screen.hidden{opacity:0;pointer-events:none}.ls-coin{width:110px;height:110px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#f0d878 0%,#d4af37 45%,#a67c00 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 0 40px rgba(212,175,55,.55),0 0 80px rgba(212,175,55,.25);position:relative;margin-bottom:28px;animation:lsPulse 2s ease-in-out infinite}.ls-coin::after{content:"";position:absolute;inset:-6px;border-radius:50%;border:3px solid transparent;border-top-color:#00ff88;border-right-color:rgba(0,255,136,.4);animation:lsSpin 1.2s linear infinite}.ls-coin img{width:68px;height:68px;border-radius:50%;object-fit:contain}.ls-title{font-size:1.55rem;font-weight:700;color:#f0d878;margin:0 0 12px;letter-spacing:.5px;text-shadow:0 0 12px rgba(212,175,55,.5)}.ls-sub{font-size:.9rem;color:#a0b0c0;line-height:1.45;margin:0 0 24px;text-align:center;max-width:280px;padding:0 16px}@keyframes lsPulse{0%,100%{box-shadow:0 0 40px rgba(212,175,55,.55),0 0 80px rgba(212,175,55,.25)}50%{box-shadow:0 0 55px rgba(212,175,55,.75),0 0 100px rgba(212,175,55,.35)}}@keyframes lsSpin{to{transform:rotate(360deg)}}</style>';
      const loadingHTML = '<div id="loading-screen"><div class="ls-coin"><img src="/hype-logo.png" alt="HYPE" onerror="this.style.display=\'none\'"/></div><div class="ls-title">Hype Token</div><div class="ls-sub">Quick security check. If a box appears below, tick it to continue.</div></div>';
      const loadingJS = '<script>(function(){function _hls(){var ls=document.getElementById("loading-screen");if(ls){ls.classList.add("hidden");setTimeout(function(){if(ls&&ls.parentNode)ls.parentNode.removeChild(ls)},600)}}window.addEventListener("load",function(){setTimeout(_hls,2200)});setTimeout(_hls,4500)})();</' + 'script>';
      const inject = loadingCSS + loadingHTML + loadingJS;
      let modified = html;
      if (modified.includes('</head>')) {
        modified = modified.replace('</head>', inject + '</head>');
      } else if (modified.includes('<body')) {
        modified = modified.replace('<body', inject + '<body');
      } else {
        modified = inject + modified;
      }
      const headers = new Headers(res.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(modified, { status: res.status, headers });
    }
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('Frontend not built. Run npm run build:frontend', 404);
});

export default app;
