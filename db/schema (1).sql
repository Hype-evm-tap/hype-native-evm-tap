-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  balance REAL DEFAULT 0,
  total_earned REAL DEFAULT 0,
  energy INTEGER DEFAULT 1000,
  energy_reset_at INTEGER DEFAULT 0,
  referred_by INTEGER,
  invite_count INTEGER DEFAULT 0,
  total_taps INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  last_active INTEGER DEFAULT (strftime('%s','now')),
  wallet_address TEXT,
  last_checkin_at INTEGER DEFAULT 0,
  checkin_streak INTEGER DEFAULT 0,
  checkin_total_earned REAL DEFAULT 0
);

-- Tasks (channels / youtube) managed by admin
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  link TEXT NOT NULL,
  reward REAL NOT NULL DEFAULT 0.0085,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- User completed tasks
CREATE TABLE IF NOT EXISTS user_tasks (
  user_id INTEGER,
  task_id INTEGER,
  completed_at INTEGER DEFAULT (strftime('%s','now')),
  PRIMARY KEY (user_id, task_id)
);

-- Withdrawal requests
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  wallet_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  admin_note TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  processed_at INTEGER
);

-- Referrals log
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  referred_id INTEGER NOT NULL UNIQUE,
  reward REAL DEFAULT 0.00008526,
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Broadcast messages
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  sent_by INTEGER,
  sent_at INTEGER DEFAULT (strftime('%s','now')),
  success_count INTEGER DEFAULT 0
);

-- Dynamic settings (admin can change rewards, energy etc.)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC);
CREATE INDEX IF NOT EXISTS idx_users_total_earned ON users(total_earned DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
