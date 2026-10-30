/**
 * Hype EVM Native — Backend (Express + better-sqlite3)
 * Supports: tap, tasks, referrals, withdraw, admin,
 * 7-day daily check-in streak + external wallet connect
 *
 * Install:  npm i express better-sqlite3 cors
 * Run:      node server.js
 * Env:      PORT=3000  ADMIN_IDS=123456789,987654321
 */

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'hype.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ───────────────── Schema ─────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance REAL DEFAULT 0,
  total_earned REAL DEFAULT 0,
  total_taps INTEGER DEFAULT 0,
  energy REAL DEFAULT 1000,
  energy_reset_at INTEGER DEFAULT 0,
  invite_count INTEGER DEFAULT 0,
  referred_by INTEGER,
  wallet_address TEXT DEFAULT '',
  is_admin INTEGER DEFAULT 0,
  last_checkin_at INTEGER DEFAULT 0,
  checkin_streak INTEGER DEFAULT 0,
  checkin_total_earned REAL DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT DEFAULT 'telegram',
  link TEXT,
  reward REAL DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS task_completions (
  user_id INTEGER,
  task_id INTEGER,
  completed_at INTEGER,
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  amount REAL,
  wallet_address TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER,
  referred_id INTEGER,
  reward REAL DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
`);

// Default settings
const DEFAULTS = {
  tap_reward: '0.0000000695',
  referral_reward: '0.001',
  min_withdraw: '1',
  energy_max: '1000',
  energy_cooldown: '3600',
  daily_checkin_reward: '0.001',
  streak_bonus: '2000',
  // Day 1..7 rewards (can be HYPE units; adjust to your economy)
  checkin_day_rewards: JSON.stringify([50, 100, 150, 300, 500, 800, 1200]),
};

const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  return DEFAULTS[key] ?? null;
};
const setSetting = (key, value) => {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
};
for (const [k, v] of Object.entries(DEFAULTS)) {
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k)) setSetting(k, v);
}

const getConfig = () => {
  let dayRewards;
  try {
    dayRewards = JSON.parse(getSetting('checkin_day_rewards') || '[]');
  } catch {
    dayRewards = [50, 100, 150, 300, 500, 800, 1200];
  }
  return {
    tap_reward: parseFloat(getSetting('tap_reward')),
    referral_reward: parseFloat(getSetting('referral_reward')),
    min_withdraw: parseFloat(getSetting('min_withdraw')),
    energy_max: parseFloat(getSetting('energy_max')),
    energy_cooldown: parseFloat(getSetting('energy_cooldown')),
    daily_checkin_reward: parseFloat(getSetting('daily_checkin_reward')),
    streak_bonus: parseFloat(getSetting('streak_bonus')),
    checkin_day_rewards: dayRewards,
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUTCDay(ts = Date.now()) {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Streak rules: check in once per UTC day. Miss a day → streak resets to 0. */
function computeCanCheckin(user) {
  if (!user.last_checkin_at) return { can: true, wait: 0 };
  const lastDay = startOfUTCDay(user.last_checkin_at);
  const today = startOfUTCDay();
  if (lastDay === today) {
    const next = today + DAY_MS;
    return { can: false, wait: Math.max(0, next - Date.now()) };
  }
  return { can: true, wait: 0 };
}

function isStreakBroken(user) {
  if (!user.last_checkin_at) return false;
  const lastDay = startOfUTCDay(user.last_checkin_at);
  const today = startOfUTCDay();
  // if last check-in was before yesterday, streak is broken
  return lastDay < today - DAY_MS;
}

function ensureUser(tgUser, startParam) {
  if (!tgUser || !tgUser.id) throw new Error('No user');
  let u = db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);
  if (!u) {
    const isAdmin = ADMIN_IDS.has(Number(tgUser.id)) ? 1 : 0;
    db.prepare(
      `INSERT INTO users (id, username, first_name, energy, is_admin) VALUES (?, ?, ?, ?, ?)`
    ).run(
      tgUser.id,
      tgUser.username || '',
      tgUser.first_name || '',
      parseFloat(getSetting('energy_max')),
      isAdmin
    );
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);

    // referral
    if (startParam) {
      const refId = parseInt(String(startParam).replace(/\D/g, ''), 10);
      if (refId && refId !== tgUser.id) {
        const ref = db.prepare('SELECT * FROM users WHERE id = ?').get(refId);
        if (ref) {
          const reward = parseFloat(getSetting('referral_reward'));
          db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').run(refId, tgUser.id);
          db.prepare(
            'UPDATE users SET balance = balance + ?, total_earned = total_earned + ?, invite_count = invite_count + 1 WHERE id = ?'
          ).run(reward, reward, refId);
          db.prepare(
            'INSERT INTO referrals (referrer_id, referred_id, reward) VALUES (?, ?, ?)'
          ).run(refId, tgUser.id, reward);
        }
      }
    }
  } else {
    db.prepare('UPDATE users SET username = ?, first_name = ? WHERE id = ?').run(
      tgUser.username || u.username,
      tgUser.first_name || u.first_name,
      tgUser.id
    );
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(tgUser.id);
  }

  // energy regen
  const energyMax = parseFloat(getSetting('energy_max'));
  const cooldown = parseFloat(getSetting('energy_cooldown')) * 1000;
  if (u.energy <= 0 && u.energy_reset_at && Date.now() >= u.energy_reset_at) {
    db.prepare('UPDATE users SET energy = ?, energy_reset_at = 0 WHERE id = ?').run(energyMax, u.id);
    u = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
  }

  // broken streak auto-reset on load
  if (isStreakBroken(u) && u.checkin_streak > 0) {
    db.prepare('UPDATE users SET checkin_streak = 0 WHERE id = ?').run(u.id);
    u.checkin_streak = 0;
  }

  return u;
}

function publicUser(u) {
  const { can, wait } = computeCanCheckin(u);
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name,
    balance: u.balance,
    total_earned: u.total_earned,
    total_taps: u.total_taps,
    energy: u.energy,
    energy_reset_at: u.energy_reset_at,
    invite_count: u.invite_count,
    wallet_address: u.wallet_address || '',
    is_admin: !!u.is_admin || ADMIN_IDS.has(Number(u.id)),
    can_checkin: can,
    checkin_wait: wait,
    checkin_streak: u.checkin_streak || 0,
    streak: u.checkin_streak || 0,
    checkin_total_earned: u.checkin_total_earned || 0,
  };
}

// ───────────────── Routes ─────────────────

app.post('/api/user', (req, res) => {
  try {
    const u = ensureUser(req.body.user, req.body.start_param);
    res.json({ user: publicUser(u), config: getConfig(), price: 0 });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/** External wallet connect / disconnect */
app.post('/api/wallet', (req, res) => {
  try {
    const tgUser = req.body.user;
    if (!tgUser?.id) return res.json({ error: 'No user' });
    ensureUser(tgUser, null);
    const addr = (req.body.wallet_address || '').trim();
    db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').run(addr, tgUser.id);
    res.json({ success: true, wallet_address: addr });
  } catch (e) {
    res.json({ error: e.message });
  }
});

/**
 * Daily check-in — 7 day streak
 * - Once per UTC day
 * - Miss a day → streak resets, this check-in becomes Day 1
 * - Day reward from checkin_day_rewards[streakIndex]
 * - On completing Day 7 → grant streak_bonus and reset streak to 0
 */
app.post('/api/checkin', (req, res) => {
  try {
    const tgUser = req.body.user;
    let u = ensureUser(tgUser, null);
    const { can, wait } = computeCanCheckin(u);

    if (!can) {
      return res.json({ already: true, wait_seconds: Math.ceil(wait / 1000) });
    }

    // reset streak if missed a day
    let streak = u.checkin_streak || 0;
    if (isStreakBroken(u)) {
      streak = 0;
    }

    const nextDay = Math.min(streak + 1, 7); // 1..7
    const cfg = getConfig();
    const rewards = cfg.checkin_day_rewards || [];
    let reward = rewards[nextDay - 1];
    if (reward == null || isNaN(reward)) reward = cfg.daily_checkin_reward || 0;

    let newStreak = nextDay;
    let bonus = 0;
    if (nextDay >= 7) {
      bonus = cfg.streak_bonus || 0;
      reward = Number(reward) + Number(bonus);
      newStreak = 0; // cycle complete
    }

    const now = Date.now();
    db.prepare(
      `UPDATE users SET
        balance = balance + ?,
        total_earned = total_earned + ?,
        last_checkin_at = ?,
        checkin_streak = ?,
        checkin_total_earned = checkin_total_earned + ?
       WHERE id = ?`
    ).run(reward, reward, now, newStreak, reward, u.id);

    res.json({
      success: true,
      reward,
      streak: newStreak === 0 && nextDay >= 7 ? 7 : newStreak, // show 7 briefly when completed
      next_streak: newStreak,
      day: nextDay,
      bonus,
      streak_total: (u.checkin_total_earned || 0) + reward,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.post('/api/tap', (req, res) => {
  try {
    const tgUser = req.body.user;
    const taps = Math.max(1, Math.min(50, parseInt(req.body.taps || 1, 10)));
    let u = ensureUser(tgUser, null);
    const energyMax = parseFloat(getSetting('energy_max'));
    const cooldownSec = parseFloat(getSetting('energy_cooldown'));
    const rewardPer = parseFloat(getSetting('tap_reward'));

    if (u.energy <= 0) {
      return res.json({
        error: 'No energy',
        energy: 0,
        energy_reset_at: u.energy_reset_at,
      });
    }

    const used = Math.min(taps, u.energy);
    const earned = used * rewardPer;
    let newEnergy = u.energy - used;
    let resetAt = u.energy_reset_at;

    if (newEnergy <= 0) {
      newEnergy = 0;
      resetAt = Date.now() + cooldownSec * 1000;
    }

    db.prepare(
      `UPDATE users SET energy = ?, energy_reset_at = ?, balance = balance + ?, total_earned = total_earned + ?, total_taps = total_taps + ? WHERE id = ?`
    ).run(newEnergy, resetAt, earned, earned, used, u.id);

    res.json({
      success: true,
      earned,
      energy: newEnergy,
      energy_reset_at: resetAt,
      taps: used,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1 ORDER BY id DESC').all();
  res.json({ tasks });
});

app.post('/api/tasks/complete', (req, res) => {
  try {
    const tgUser = req.body.user;
    const taskId = req.body.task_id;
    const u = ensureUser(tgUser, null);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(taskId);
    if (!task) return res.json({ error: 'Task not found' });
    const done = db
      .prepare('SELECT 1 FROM task_completions WHERE user_id = ? AND task_id = ?')
      .get(u.id, taskId);
    if (done) return res.json({ error: 'Already completed' });
    db.prepare('INSERT INTO task_completions (user_id, task_id, completed_at) VALUES (?, ?, ?)').run(
      u.id,
      taskId,
      Date.now()
    );
    db.prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?').run(
      task.reward,
      task.reward,
      u.id
    );
    res.json({ success: true, reward: task.reward });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/leaderboard', (req, res) => {
  const rows = db
    .prepare(
      'SELECT id, username, first_name, total_earned, total_taps FROM users ORDER BY total_earned DESC LIMIT 100'
    )
    .all();
  res.json({ leaderboard: rows });
});

app.get('/api/referrals', (req, res) => {
  // frontend loads after user; optional filter via query not used — return empty list shape
  res.json({ referrals: [] });
});

app.post('/api/referrals', (req, res) => {
  try {
    const u = ensureUser(req.body.user, null);
    const rows = db
      .prepare(
        `SELECT r.*, u.username, u.first_name FROM referrals r
         LEFT JOIN users u ON u.id = r.referred_id
         WHERE r.referrer_id = ? ORDER BY r.id DESC LIMIT 100`
      )
      .all(u.id);
    res.json({ referrals: rows, invite_count: u.invite_count });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/withdrawals', (req, res) => {
  res.json({ withdrawals: [] });
});

app.post('/api/withdraw', (req, res) => {
  try {
    const tgUser = req.body.user;
    const amount = parseFloat(req.body.amount);
    const wallet = (req.body.wallet_address || '').trim();
    const u = ensureUser(tgUser, null);
    const min = parseFloat(getSetting('min_withdraw'));
    if (!wallet || wallet.length < 10) return res.json({ error: 'Connect wallet first' });
    if (!amount || amount < min) return res.json({ error: `Min ${min} HYPE` });
    if (u.balance < amount) return res.json({ error: 'Insufficient balance' });
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, u.id);
    const info = db
      .prepare(
        'INSERT INTO withdrawals (user_id, amount, wallet_address, status) VALUES (?, ?, ?, ?)'
      )
      .run(u.id, amount, wallet, 'pending');
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get('/api/withdrawals', (req, res) => {
  // need user — frontend calls without body; use header or return all for user via separate path
  res.json({ withdrawals: [] });
});

// Frontend loads user withdrawals — support POST body
app.post('/api/withdrawals', (req, res) => {
  try {
    const u = ensureUser(req.body.user, null);
    const rows = db
      .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50')
      .all(u.id);
    res.json({ withdrawals: rows });
  } catch (e) {
    res.json({ withdrawals: [] });
  }
});

// ──── Admin helpers ────
function requireAdmin(req, res) {
  // Prefer Telegram init data in production; here allow body.admin_id or X-Admin-Id
  const adminId = Number(req.headers['x-admin-id'] || req.body?.admin_id || 0);
  // Also accept if any known admin exists when testing
  if (ADMIN_IDS.size && !ADMIN_IDS.has(adminId)) {
    // soft-check: allow if user row is_admin
    const u = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(adminId);
    if (!u?.is_admin) {
      res.json({ error: 'Forbidden' });
      return null;
    }
  }
  return true;
}

app.get('/api/admin/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const taps = db.prepare('SELECT SUM(total_taps) AS s FROM users').get().s || 0;
  const earned = db.prepare('SELECT SUM(total_earned) AS s FROM users').get().s || 0;
  const pending = db
    .prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'")
    .get().c;
  res.json({ users, taps, earned, pending_withdrawals: pending });
});

app.get('/api/admin/withdrawals', (req, res) => {
  const status = req.query.status || 'pending';
  const rows = db
    .prepare(
      `SELECT w.*, u.username, u.first_name FROM withdrawals w
       LEFT JOIN users u ON u.id = w.user_id
       WHERE w.status = ? ORDER BY w.id DESC LIMIT 100`
    )
    .all(status);
  res.json({ withdrawals: rows });
});

app.post('/api/admin/withdrawals/:id', (req, res) => {
  const action = req.body.action; // approve | reject
  const status = action === 'approve' ? 'approved' : 'rejected';
  if (status === 'rejected') {
    const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
    if (w && w.status === 'pending') {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
    }
  }
  db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/tasks', (req, res) => {
  res.json({ tasks: db.prepare('SELECT * FROM tasks ORDER BY id DESC').all() });
});

app.post('/api/admin/tasks', (req, res) => {
  const { title, type, link, reward } = req.body;
  const info = db
    .prepare('INSERT INTO tasks (title, type, link, reward) VALUES (?, ?, ?, ?)')
    .run(title, type || 'telegram', link || '', parseFloat(reward) || 0);
  res.json({ success: true, id: info.lastInsertRowid });
});

app.delete('/api/admin/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/settings', (req, res) => {
  res.json(getConfig());
});

app.post('/api/admin/settings', (req, res) => {
  const b = req.body || {};
  const map = {
    tap_reward: b.tap_reward,
    referral_reward: b.referral_reward,
    min_withdraw: b.min_withdraw,
    energy_max: b.energy_max,
    energy_cooldown: b.energy_cooldown,
    daily_checkin_reward: b.daily_checkin_reward,
    streak_bonus: b.streak_bonus,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined && v !== null && v !== '') setSetting(k, v);
  }
  if (Array.isArray(b.checkin_day_rewards)) {
    setSetting('checkin_day_rewards', JSON.stringify(b.checkin_day_rewards.map(Number)));
  }
  res.json({ success: true, settings: getConfig() });
});

app.get('/api/admin/leaderboard', (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  res.json({
    leaderboard: db
      .prepare(
        'SELECT id, username, first_name, balance, total_earned, total_taps, invite_count FROM users ORDER BY total_earned DESC LIMIT ?'
      )
      .all(limit),
  });
});

app.get('/api/admin/referrals', (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || '50', 10));
  res.json({
    referrals: db
      .prepare('SELECT * FROM referrals ORDER BY id DESC LIMIT ?')
      .all(limit),
  });
});

app.get('/api/admin/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.json({ error: 'Not found' });
  res.json({ user: publicUser(u) });
});

app.post('/api/admin/users/:id', (req, res) => {
  const b = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.json({ error: 'Not found' });
  db.prepare(
    `UPDATE users SET
      balance = COALESCE(?, balance),
      total_earned = COALESCE(?, total_earned),
      total_taps = COALESCE(?, total_taps),
      is_admin = COALESCE(?, is_admin),
      invite_count = COALESCE(?, invite_count)
     WHERE id = ?`
  ).run(
    b.balance != null ? parseFloat(b.balance) : null,
    b.total_earned != null ? parseFloat(b.total_earned) : null,
    b.total_taps != null ? parseInt(b.total_taps, 10) : null,
    b.is_admin != null ? (b.is_admin ? 1 : 0) : null,
    b.invite_count != null ? parseInt(b.invite_count, 10) : null,
    req.params.id
  );
  res.json({ success: true });
});

app.delete('/api/admin/users/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/broadcast', (req, res) => {
  // Hook your Telegram bot sendMessage loop here
  res.json({ success: true, sent: 0, message: 'Wire Telegram bot token to enable broadcast' });
});

// Fix withdrawals list for frontend GET with telegram — also expose by user POST above

app.listen(PORT, () => {
  console.log(`Hype server on :${PORT}`);
  console.log('Admin IDs:', [...ADMIN_IDS].join(', ') || '(none set)');
});
