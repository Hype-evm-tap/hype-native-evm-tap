-- Run on existing D1 if users table already deployed without streak columns
ALTER TABLE users ADD COLUMN checkin_streak INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN checkin_total_earned REAL DEFAULT 0;
