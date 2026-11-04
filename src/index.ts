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
import { parseUnits, recoverMessageAddress } from 'viem';
import { Address, Cell, TonClient4, contractAddress, loadStateInit, WalletContractV1R1, WalletContractV1R2, WalletContractV1R3, WalletContractV2R1, WalletContractV2R2, WalletContractV3R1, WalletContractV3R2, WalletContractV4 as WalletContractV4R2, WalletContractV5R1 } from '@ton/ton';

type Bindings = {
  DB: D1Database;
  TONCENTER_API_KEY?: string;
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
  HYPE_TREASURY_ADDRESS?: string;
  HYPE_EVM_RPC?: string;
  MONETAG_POSTBACK_SECRET?: string;
};

type TgUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  start_param?: string;
  is_premium?: boolean;
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
  ad_reward: '0.0000007854',
  ads_enabled: '1',
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
  const safeNumber = (raw: string, fallback: number, min = 0, max = 1000000) => {
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  };
  const defaults = [0.0000089, 0.000002, 0.000006, 0.000007, 0.0000079, 0.0000089, 0.0004];
  let dayRewards = defaults;
  try {
    const parsed = JSON.parse(await getSetting(db, 'checkin_day_rewards'));
    if (Array.isArray(parsed) && parsed.length === 7 && parsed.every((v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1000000)) dayRewards = parsed.map(Number);
  } catch {}
  return {
    tap_reward: safeNumber(await getConfiguredSetting(db, 'tap_reward', env?.TAP_REWARD), 0.0000000695),
    referral_reward: safeNumber(await getConfiguredSetting(db, 'referral_reward', env?.REFERRAL_REWARD), 0.00008526),
    min_withdraw: safeNumber(await getConfiguredSetting(db, 'min_withdraw', env?.MIN_WITHDRAW), 2, 0.00000001),
    energy_max: safeNumber(await getConfiguredSetting(db, 'energy_max', env?.ENERGY_MAX), 1000, 1),
    energy_cooldown: safeNumber(await getConfiguredSetting(db, 'energy_cooldown', env?.ENERGY_COOLDOWN_SEC), 3600, 60, 604800),
    daily_checkin_reward: safeNumber(await getSetting(db, 'daily_checkin_reward'), 0.0000089),
    streak_bonus: safeNumber(await getSetting(db, 'streak_bonus'), 0),
    checkin_day_rewards: dayRewards,
    ad_reward: safeNumber(await getSetting(db, 'ad_reward'), 0.0000007854),
    ads_enabled: (await getSetting(db, 'ads_enabled')) === '1',
    bot_username: env?.BOT_USERNAME || '',
  };
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
    return {
      id: Number(user.id),
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      start_param: params.get('start_param') || '',
      is_premium: Boolean(user.is_premium),
    };
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
  if (['/api/health', '/api/config', '/api/price', '/api/monetag/postback'].includes(path)) return next();
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

// TON Connect requires a same-origin manifest. Keep the URL dynamic for custom domains.
app.get('/tonconnect-manifest.json', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    url: origin,
    name: 'HYPE Native',
    iconUrl: origin + '/hype-logo.png',
  }, 200, {
    'Cache-Control': 'public, max-age=300',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
});

// ──── Routes ────

// YouTube tasks use a manual visit flow; no Google account or OAuth is required.

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/config', async (c) => {
  const id = c.env.WALLETCONNECT_PROJECT_ID || c.env.VITE_WALLETCONNECT_PROJECT_ID || '';
  const config = await getConfig(c.env.DB, c.env);
  return c.json({ walletConnectProjectId: id, bot_username: c.env.BOT_USERNAME || '', ad_reward: config.ad_reward, ads_enabled: config.ads_enabled, ads_daily_limit: 100000 });
});


const DEPOSIT_WALLETS = {
  ton: 'UQBtBjwUwBXKsJuRr1UFdba_B1Rh8gXo0uFBzuT9-mVC17yl',
  bep20: '0xaaa40bd792bd26c1e5f6481b25ac1f8d4cf62f4a',
  trc20: 'THcEQMCe1eyfajz7TyFUe8EmW2AQuCc1do',
  ethereum: '0x87Ad7Fe8Be9eeEa2E388F80f4C5fcF450E037463',
};
const USDT_CONTRACTS = {
  bep20: '0x55d398326f99059fF775485246999027B3197955',
  trc20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
};
const ETHEREUM_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';


async function ensureDepositSwapTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS deposit_swap_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    deposit_network TEXT NOT NULL, deposit_tx_hash TEXT NOT NULL, asset TEXT NOT NULL,
    amount TEXT NOT NULL, entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit','reserve','swap_debit','swap_credit','release','withdrawal')),
    reference_type TEXT, reference_id TEXT, idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending','posted','reversed')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE (deposit_network, deposit_tx_hash, entry_type, idempotency_key)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS deposit_swap_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, ledger_deposit_id INTEGER NOT NULL,
    request_key TEXT NOT NULL UNIQUE, from_network TEXT NOT NULL, from_asset TEXT NOT NULL,
    from_amount TEXT NOT NULL, to_asset TEXT NOT NULL DEFAULT 'HYPE' CHECK (to_asset = 'HYPE'),
    quoted_hype_amount TEXT, received_hype_amount TEXT, provider TEXT, quote_reference TEXT,
    source_tx_hash TEXT, swap_tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','submitted','completed','failed','refunded')),
    error_code TEXT, error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_deposit_swap_swap_tx_unique ON deposit_swap_orders(swap_tx_hash) WHERE swap_tx_hash IS NOT NULL AND swap_tx_hash <> ''").run();
}

async function ensureDepositTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS crypto_deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, network TEXT NOT NULL, tx_hash TEXT NOT NULL, amount TEXT NOT NULL, token TEXT NOT NULL, from_address TEXT, to_address TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(network, tx_hash))').run();
}
async function ensureWithdrawalTxColumn(db: D1Database) {
  try { await db.prepare("ALTER TABLE withdrawals ADD COLUMN tx_hash TEXT NOT NULL DEFAULT ''").run(); } catch {}
  try { await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_tx_hash_unique ON withdrawals(tx_hash) WHERE tx_hash IS NOT NULL AND tx_hash <> ''").run(); } catch {}
}
async function verifyHyperevmNativeTransfer(env: Bindings, txHashInput: string, recipientInput: string, minAmountInput: string, expectedSenderInput?: string) {
  const txHash = String(txHashInput || '').trim();
  const recipient = String(recipientInput || '').trim().toLowerCase();
  const expectedSender = String(expectedSenderInput || '').trim().toLowerCase();
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error('Enter a valid HyperEVM transaction hash.');
  if (!/^0x[a-f0-9]{40}$/.test(recipient)) throw new Error('Invalid treasury or recipient wallet address.');
  if (expectedSender && !/^0x[a-f0-9]{40}$/.test(expectedSender)) throw new Error('HYPE_TREASURY_ADDRESS is not configured correctly.');
  let minimum: bigint;
  try { minimum = parseUnits(String(minAmountInput), 18); } catch { throw new Error('Invalid HYPE amount.'); }
  if (minimum <= 0n) throw new Error('HYPE amount must be greater than zero.');
  const rpc = env.HYPE_EVM_RPC || 'https://rpc.hyperliquid.xyz/evm';
  const call = async (method: string, params: any[]) => {
    const response = await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('HyperEVM RPC is unavailable. Try again later.');
    const payload: any = await response.json();
    if (payload.error) throw new Error('HyperEVM RPC verification failed: ' + String(payload.error.message || 'unknown error'));
    return payload.result;
  };
  const chainId = await call('eth_chainId', []);
  if (String(chainId).toLowerCase() !== '0x3e7') throw new Error('RPC is not connected to HyperEVM mainnet (chain ID 999).');
  const [tx, receipt] = await Promise.all([call('eth_getTransactionByHash', [txHash]), call('eth_getTransactionReceipt', [txHash])]);
  if (!tx || !receipt) throw new Error('Transaction is not yet confirmed on HyperEVM.');
  if (String(receipt.status).toLowerCase() !== '0x1') throw new Error('HyperEVM transaction failed.');
  if (String(tx.to || '').toLowerCase() !== recipient) throw new Error('Transaction recipient does not match the expected wallet.');
  if (expectedSender && String(tx.from || '').toLowerCase() !== expectedSender) throw new Error('Transaction sender does not match the configured HYPE treasury wallet.');
  if (String(tx.input || '0x').toLowerCase() !== '0x') throw new Error('Only a direct native HYPE transfer is accepted for settlement.');
  const value = BigInt(String(tx.value || '0x0'));
  if (value < minimum) throw new Error('Confirmed HYPE transfer is smaller than the amount being credited or paid.');
  return { tx_hash: txHash, from: String(tx.from || '').toLowerCase(), to: recipient, amount: formatUnits(value, 18) };
}
function formatUnits(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals), whole = raw / base;
  const fraction = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? String(whole) + '.' + fraction : String(whole);
}
function tonHashHex(value: string): string {
  const input = String(value || '').trim();
  if (/^[a-fA-F0-9]{64}$/.test(input)) return input.toLowerCase();
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]{43}$/.test(base64)) return '';
  try {
    const binary = atob(base64 + '=');
    if (binary.length !== 32) return '';
    return Array.from(binary, (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
function tonRawAddress(value: string): string {
  const input = String(value || '').trim();
  const raw = input.match(/^(-?\d+):([a-fA-F0-9]{64})$/);
  if (raw) return String(Number(raw[1])) + ':' + raw[2].toLowerCase();
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    if (binary.length !== 36) return '';
    const wc = binary.charCodeAt(1) > 127 ? binary.charCodeAt(1) - 256 : binary.charCodeAt(1);
    const account = Array.from(binary.slice(2), (ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return wc + ':' + account;
  } catch { return ''; }
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function hexBytes(hex: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(hex)) throw new Error('Invalid hex bytes');
  return Uint8Array.from(hex.match(/.{2}/g) || [], (x) => parseInt(x, 16));
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function littleEndian(value: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) { out[i] = Number(value & 255n); value >>= 8n; }
  return out;
}
function extractTonWalletPublicKey(stateInit: any): Uint8Array {
  const dummy = new Uint8Array(32);
  const wallets: any[] = [
    { contract: WalletContractV1R1, load: (s: any) => { s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV1R2, load: (s: any) => { s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV1R3, load: (s: any) => { s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV2R1, load: (s: any) => { s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV2R2, load: (s: any) => { s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV3R1, load: (s: any) => { s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV3R2, load: (s: any) => { s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV4R2, load: (s: any) => { s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
    { contract: WalletContractV5R1, load: (s: any) => { s.loadBoolean(); s.loadUint(32); s.loadUint(32); return s.loadBuffer(32); } },
  ];
  const wanted = bytesToHex(stateInit.code.hash());
  for (const item of wallets) {
    const code = item.contract.create({ workchain: 0, publicKey: dummy }).init.code;
    if (bytesToHex(code.hash()) === wanted) {
      const key = new Uint8Array(item.load(stateInit.data.beginParse()));
      if (key.length !== 32) throw new Error('Invalid TON wallet public key');
      return key;
    }
  }
  throw new Error('Unsupported TON wallet contract. Use a standard TON wallet (V1–V5).');
}
async function verifyTonConnectProof(input: any, expectedDomain: string, expectedPayload: string): Promise<{ addressRaw: string; addressFriendly: string; publicKey: string; network: string }> {
  const address = Address.parse(String(input.address || ''));
  const network = String(input.network || '');
  if (network !== '-239') throw new Error('Connect a TON mainnet wallet.');
  const proof = input.proof || {};
  const timestamp = Number(proof.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSec() - timestamp) > 600) throw new Error('TON wallet proof expired. Reconnect your wallet.');
  const domain = String(proof.domain?.value || '');
  const domainBytes = new TextEncoder().encode(domain);
  if (domain !== expectedDomain || Number(proof.domain?.lengthBytes) !== domainBytes.length) throw new Error('TON proof domain mismatch.');
  if (String(proof.payload || '') !== expectedPayload) throw new Error('TON proof challenge mismatch.');
  const stateInitBoc = String(input.wallet_state_init || '');
  if (!stateInitBoc) throw new Error('TON wallet state init is missing.');
  const stateInit = loadStateInit(Cell.fromBase64(stateInitBoc).beginParse());
  const derived = contractAddress(address.workChain, stateInit);
  if (!derived.equals(address)) throw new Error('TON wallet address does not match its state init.');
  const walletTgTrampolineHash = '9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768';
  let publicKey: Uint8Array;
  if (stateInit.code && bytesToHex(stateInit.code.hash()) === walletTgTrampolineHash) {
    // Telegram Wallet uses WalletTg: its StateInit contains an immutable
    // trampoline, while the current signing key is read from the live account.
    // Verify both the trampoline and active on-chain code before trusting getter.
    const tonClient = new TonClient4({ endpoint: 'https://mainnet-v4.tonhubapi.com' });
    const provider = tonClient.provider(address, null);
    const account = await provider.getState();
    if (account.state.type !== 'active' || !account.state.code) {
      throw new Error('Telegram Wallet account is not active on TON mainnet.');
    }
    const activeCode = Cell.fromBoc(account.state.code);
    if (activeCode.length !== 1 || bytesToHex(activeCode[0].hash()) !== walletTgTrampolineHash) {
      throw new Error('TON account code is not a verified Telegram Wallet contract.');
    }
    const getter = await provider.get('get_public_key', []);
    const keyValue = getter.stack.readBigNumber();
    if (keyValue < 0n || keyValue >= (1n << 256n)) {
      throw new Error('Telegram Wallet returned an invalid signing public key.');
    }
    publicKey = hexBytes(keyValue.toString(16).padStart(64, '0'));
  } else {
    publicKey = extractTonWalletPublicKey(stateInit);
  }
  if (input.public_key && String(input.public_key).toLowerCase() !== bytesToHex(publicKey)) {
    throw new Error('TON wallet public key mismatch.');
  }
  const workchain = new Uint8Array(4);
  new DataView(workchain.buffer).setInt32(0, address.workChain, false);
  const domainLength = new Uint8Array(4);
  new DataView(domainLength.buffer).setUint32(0, domainBytes.length, true);
  const timestampBytes = littleEndian(BigInt(timestamp), 8);
  const payloadBytes = new TextEncoder().encode(expectedPayload);
  const message = concatBytes(new TextEncoder().encode('ton-proof-item-v2/'), workchain, hexBytes(address.hash.toString('hex')), domainLength, domainBytes, timestampBytes, payloadBytes);
  const messageHash = new Uint8Array(await crypto.subtle.digest('SHA-256', message));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concatBytes(new Uint8Array([255, 255]), new TextEncoder().encode('ton-connect'), messageHash)));
  const signatureBinary = atob(String(proof.signature || ''));
  const signature = Uint8Array.from(signatureBinary, (ch) => ch.charCodeAt(0));
  if (signature.length !== 64) throw new Error('Invalid TON wallet signature.');
  const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' } as any, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'Ed25519' } as any, key, signature, digest);
  if (!valid) throw new Error('TON wallet signature is invalid.');
  return { addressRaw: address.toRawString(), addressFriendly: address.toString({ bounceable: true, urlSafe: true }), publicKey: bytesToHex(publicKey), network };
}
async function ensureTonProofTables(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS ton_proof_challenges (user_id INTEGER PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS ton_wallet_links (user_id INTEGER PRIMARY KEY, address_raw TEXT NOT NULL UNIQUE, address_friendly TEXT NOT NULL, public_key TEXT NOT NULL, network TEXT NOT NULL, verified_at INTEGER NOT NULL)').run();
}
async function ensureActivityTables(db: D1Database) {
  await ensureDepositTable(db);
  await db.prepare("CREATE TABLE IF NOT EXISTS swap_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, from_asset TEXT NOT NULL, to_asset TEXT NOT NULL, from_amount TEXT NOT NULL, to_amount TEXT NOT NULL, tx_hash TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'completed', created_at INTEGER NOT NULL)").run();
}

async function verifyTonDeposit(hashInput: string, apiKey: string) {
  // TON Center allows unauthenticated public requests at a strict low rate.
  // Keep the API key optional so TON deposits still work on a fresh deployment.
  const hash = tonHashHex(hashInput);
  if (!hash) throw new Error('Enter a valid TON transaction hash (64-character hex or TON base64 hash).');
  const walletRaw = tonRawAddress(DEPOSIT_WALLETS.ton);
  if (!walletRaw) throw new Error('TON deposit wallet configuration is invalid.');
  const url = 'https://toncenter.com/api/v3/transactions?account=' + encodeURIComponent(DEPOSIT_WALLETS.ton) + '&hash=' + encodeURIComponent(hash) + '&limit=10';
  const response = await fetch(url, apiKey ? { headers: { 'X-API-Key': apiKey } } : {});
  if (!response.ok) {
    if (response.status === 404) throw new Error('TON transaction was not found for the deposit wallet.');
    if (response.status === 429) throw new Error('TON Center public rate limit reached. Retry shortly or configure TONCENTER_API_KEY in Cloudflare.');
    throw new Error('TON blockchain verification service unavailable. Try again shortly.');
  }
  const data: any = await response.json();
  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const tx = transactions.find((item: any) => tonHashHex(String(item.hash || '')) === hash);
  if (!tx) throw new Error('This transaction hash does not belong to the TON deposit wallet.');
  const accountRaw = tonRawAddress(String(tx.account || ''));
  const destinationRaw = tonRawAddress(String(tx.in_msg?.destination || ''));
  if (accountRaw !== walletRaw || destinationRaw !== walletRaw) throw new Error('TON transaction recipient does not match your deposit wallet.');
  if (!tx.in_msg || tx.in_msg.bounced === true) throw new Error('No successful incoming TON transfer was found.');
  if (!tx.description || tx.description.aborted !== false) throw new Error('TON transaction has not been confirmed successful.');
  if (!Number(tx.mc_block_seqno || 0)) return { pending: true, error: 'TON transaction is waiting for masterchain confirmation.' };
  const raw = BigInt(String(tx.in_msg.value || '0'));
  if (raw <= 0n) throw new Error('Incoming TON amount is zero.');
  return { amount: formatUnits(raw, 9), from: String(tx.in_msg.source || ''), to: DEPOSIT_WALLETS.ton, token: 'TON' };
}
async function evmToTronAddress(address: string): Promise<string> {
  const hex = String(address || '').toLowerCase().replace(/^0x/, '');
  if (!/^[a-f0-9]{40}$/.test(hex)) return '';
  const payload = new Uint8Array(21);
  payload[0] = 0x41;
  for (let i = 0; i < 20; i++) payload[i + 1] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const first = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));
  const second = new Uint8Array(await crypto.subtle.digest('SHA-256', first));
  const full = new Uint8Array(25);
  full.set(payload);
  full.set(second.slice(0, 4), 21);
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of full) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) { const rem = Number(value % 58n); encoded = alphabet[rem] + encoded; value /= 58n; }
  for (const byte of full) { if (byte !== 0) break; encoded = '1' + encoded; }
  return encoded;
}
async function verifyBep20Deposit(hash: string) {
  const rpc = async (method: string, params: any[]) => {
    const response = await fetch('https://bsc-dataseed.binance.org/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!response.ok) throw new Error('BNB Chain RPC unavailable');
    const data: any = await response.json();
    if (data.error) throw new Error('BNB Chain could not verify this transaction');
    return data.result;
  };
  const receipt: any = await rpc('eth_getTransactionReceipt', [hash]);
  if (!receipt) return { pending: true, error: 'Transaction not found yet. Check the hash and try again.' };
  if (receipt.transactionHash && String(receipt.transactionHash).toLowerCase() !== hash.toLowerCase()) throw new Error('BNB Chain transaction hash mismatch.');
  if (receipt.status !== '0x1') throw new Error('Transaction failed on BNB Chain');
  const blockNumber = Number(BigInt(receipt.blockNumber)), latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  if (latest - blockNumber < 12) return { pending: true, error: 'Transaction found but is waiting for 12 confirmations.' };
  const wallet = DEPOSIT_WALLETS.bep20.toLowerCase().replace('0x', '').padStart(64, '0');
  const logs = (receipt.logs || []).filter((entry: any) => String(entry.address).toLowerCase() === USDT_CONTRACTS.bep20.toLowerCase() && String(entry.topics?.[0]).toLowerCase() === TRANSFER_TOPIC && String(entry.topics?.[2] || '').toLowerCase() === '0x' + wallet);
  if (!logs.length) throw new Error('No USDT BEP20 transfer to the deposit wallet was found.');
  const senders = [...new Set(logs.map((entry: any) => '0x' + String(entry.topics[1] || '').slice(-40).toLowerCase()))];
  if (senders.length !== 1) throw new Error('Transaction contains transfers from multiple senders; it cannot be safely attributed to one wallet.');
  const raw = logs.reduce((sum: bigint, entry: any) => sum + BigInt(entry.data || '0x0'), 0n);
  if (raw <= 0n) throw new Error('Deposit amount is zero.');
  return { amount: formatUnits(raw, 18), from: senders[0], to: DEPOSIT_WALLETS.bep20, token: 'USDT' };
}
async function verifyEthereumDeposit(hash: string, asset: 'eth' | 'usdc_eth') {
  const rpc = async (method: string, params: any[]) => {
    let lastError: any;
    for (const endpoint of ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com']) {
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
        if (!response.ok) throw new Error('Ethereum RPC unavailable');
        const data: any = await response.json();
        if (data.error) throw new Error('Ethereum could not verify this transaction');
        return data.result;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Ethereum RPC unavailable');
  };
  const receipt: any = await rpc('eth_getTransactionReceipt', [hash]);
  if (!receipt) return { pending: true, error: 'Ethereum transaction not found yet. Check the hash and try again.' };
  if (String(receipt.transactionHash || '').toLowerCase() !== hash.toLowerCase()) throw new Error('Ethereum transaction hash mismatch.');
  if (receipt.status !== '0x1') throw new Error('Transaction failed on Ethereum.');
  const blockNumber = Number(BigInt(receipt.blockNumber));
  const latest = Number(BigInt(await rpc('eth_blockNumber', [])));
  if (latest - blockNumber < 12) return { pending: true, error: 'Ethereum transaction is waiting for 12 confirmations.' };
  const recipient = DEPOSIT_WALLETS.ethereum.toLowerCase();
  if (asset === 'eth') {
    const tx: any = await rpc('eth_getTransactionByHash', [hash]);
    if (!tx || String(tx.to || '').toLowerCase() !== recipient) throw new Error('No native ETH transfer to the Ethereum deposit address was found.');
    const raw = BigInt(String(tx.value || '0x0'));
    if (raw <= 0n) throw new Error('ETH deposit amount is zero.');
    return { amount: formatUnits(raw, 18), from: String(tx.from || '').toLowerCase(), to: DEPOSIT_WALLETS.ethereum, token: 'ETH' };
  }
  const target = recipient.replace(/^0x/, '').padStart(64, '0');
  const logs = (receipt.logs || []).filter((entry: any) =>
    String(entry.address || '').toLowerCase() === ETHEREUM_USDC.toLowerCase() &&
    String(entry.topics?.[0] || '').toLowerCase() === TRANSFER_TOPIC &&
    String(entry.topics?.[2] || '').toLowerCase() === '0x' + target
  );
  if (!logs.length) throw new Error('No USDC (Ethereum ERC20) transfer to the deposit address was found.');
  const senders = [...new Set(logs.map((entry: any) => '0x' + String(entry.topics[1] || '').slice(-40).toLowerCase()))];
  if (senders.length !== 1) throw new Error('Transaction contains transfers from multiple senders; it cannot be safely attributed to one wallet.');
  const raw = logs.reduce((sum: bigint, entry: any) => sum + BigInt(entry.data || '0x0'), 0n);
  if (raw <= 0n) throw new Error('USDC deposit amount is zero.');
  return { amount: formatUnits(raw, 6), from: senders[0], to: DEPOSIT_WALLETS.ethereum, token: 'USDC' };
}
async function verifyTrc20Deposit(hash: string) {
  const infoResponse = await fetch('https://api.trongrid.io/wallet/gettransactioninfobyid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: hash }) });
  if (!infoResponse.ok) throw new Error('TRON transaction verification service unavailable.');
  const info: any = await infoResponse.json();
  if (!info?.id || !info.blockNumber) return { pending: true, error: 'TRON transaction is not confirmed yet.' };
  if (String(info.id).toLowerCase() !== hash.toLowerCase()) throw new Error('TRON transaction hash mismatch.');
  if (String(info.receipt?.result || '').toUpperCase() !== 'SUCCESS') throw new Error('TRON transaction did not execute successfully.');
  const response = await fetch('https://api.trongrid.io/v1/transactions/' + encodeURIComponent(hash) + '/events?only_confirmed=true&limit=200');
  if (!response.ok) throw new Error('TRON event verification service unavailable. Try again shortly.');
  const data: any = await response.json();
  const events = (data.data || []).filter((event: any) => event.event_name === 'Transfer' && String(event.transaction_id || '').toLowerCase() === hash.toLowerCase() && String(event.contract_address) === USDT_CONTRACTS.trc20 && String(event.result?.to) === DEPOSIT_WALLETS.trc20 && BigInt(String(event.result?.value || '0')) > 0n);
  if (!events.length) throw new Error('No confirmed USDT TRC20 transfer to the deposit wallet was found.');
  const senders = [...new Set(events.map((event: any) => String(event.result.from || '')))];
  if (senders.length !== 1) throw new Error('Transaction contains transfers from multiple senders; it cannot be safely attributed to one wallet.');
  const raw = events.reduce((sum: bigint, event: any) => sum + BigInt(String(event.result.value)), 0n);
  return { amount: formatUnits(raw, 6), from: senders[0], to: DEPOSIT_WALLETS.trc20, token: 'USDT' };
}
app.get('/api/deposits', async (c) => {
  const userId = c.get('tgUser').id;
  await ensureDepositTable(c.env.DB);
  const { results } = await c.env.DB.prepare('SELECT id, network, tx_hash, amount, token, from_address, to_address, created_at FROM crypto_deposits WHERE user_id = ? ORDER BY id DESC LIMIT 30').bind(userId).all();
  const totals = await c.env.DB.prepare('SELECT network, SUM(CAST(amount AS REAL)) AS amount FROM crypto_deposits WHERE user_id = ? GROUP BY network').bind(userId).all();
  const balances: any = { ton: 0, bep20: 0, trc20: 0, eth: 0 };
  for (const row of (totals.results || []) as any[]) balances[row.network] = Number(row.amount) || 0;
  return c.json({ deposits: results || [], balances, wallets: DEPOSIT_WALLETS });
});
app.get('/api/deposit-swaps', async (c) => {
  const userId = c.get('tgUser').id;
  await ensureDepositSwapTables(c.env.DB);
  const { results } = await c.env.DB.prepare(
    'SELECT id, from_network, from_asset, from_amount, received_hype_amount, status, source_tx_hash, swap_tx_hash, created_at, updated_at FROM deposit_swap_orders WHERE user_id = ? ORDER BY id DESC LIMIT 30'
  ).bind(userId).all();
  const account = await c.env.DB.prepare('SELECT balance FROM users WHERE id = ?').bind(userId).first<any>();
  return c.json({ orders: results || [], hype_balance: Number(account?.balance || 0) });
});

app.post('/api/deposits/verify', async (c) => {
  try {
    const userId = c.get('tgUser').id, body = await c.req.json().catch(() => ({}));
    const network = String(body.network || '').toLowerCase(), hash = String(body.tx_hash || '').trim();
    if (!['ton', 'bep20', 'trc20', 'eth'].includes(network)) return c.json({ error: 'Only native TON, USDT BEP20, USDT TRC20, and ETH deposits are accepted.' }, 400);
    const validHash = network === 'ton' ? !!tonHashHex(hash) : (network === 'bep20' || network === 'eth' || network === 'usdc_eth') ? /^0x[a-fA-F0-9]{64}$/.test(hash) : /^[a-fA-F0-9]{64}$/.test(hash);
    if (!validHash) return c.json({ error: 'Enter a valid transaction hash.' }, 400);
    await ensureDepositTable(c.env.DB);
    const normalizedHash = network === 'ton' ? tonHashHex(hash) : hash.toLowerCase();
    const existing = await c.env.DB.prepare('SELECT user_id FROM crypto_deposits WHERE network = ? AND tx_hash = ?').bind(network, normalizedHash).first<any>();
    if (existing) return c.json({ error: 'This transaction has already been credited.' }, 409);
    const verified: any = network === 'ton'
      ? await verifyTonDeposit(hash, c.env.TONCENTER_API_KEY || '')
      : network === 'bep20' ? await verifyBep20Deposit(normalizedHash) : network === 'trc20' ? await verifyTrc20Deposit(normalizedHash) : await verifyEthereumDeposit(normalizedHash, network as 'eth' | 'usdc_eth');
    if (verified.pending) return c.json({ pending: true, error: verified.error }, 202);
    // Sender ownership: require a previously signature-verified EVM wallet.
    // BSC and TRON use the same secp256k1 account key; the TRON address is
    // deterministically derived from the linked EVM address and compared exactly.
    const linked = await c.env.DB.prepare('SELECT wallet_address FROM users WHERE id = ?').bind(userId).first<any>();
    const linkedEvm = String(linked?.wallet_address || '').trim();
    if (network === 'ton') {
      await ensureTonProofTables(c.env.DB);
      const tonLink = await c.env.DB.prepare('SELECT address_raw FROM ton_wallet_links WHERE user_id = ?').bind(userId).first<any>();
      if (!tonLink?.address_raw) return c.json({ error: 'Connect and verify your TON wallet with TON Connect first.' }, 403);
      if (tonRawAddress(String(verified.from || '')) !== String(tonLink.address_raw)) {
        return c.json({ error: 'TON transaction sender does not match your verified TON wallet. No balance was credited.' }, 403);
      }
    } else if (!/^0x[a-fA-F0-9]{40}$/.test(linkedEvm)) {
      return c.json({ error: 'Connect and sign your EVM wallet first. Sender ownership cannot be verified without a linked wallet.' }, 403);
    }
    if ((network === 'bep20' || network === 'eth' || network === 'usdc_eth') && String(verified.from || '').toLowerCase() !== linkedEvm.toLowerCase()) {
      return c.json({ error: 'Sender wallet does not match your signature-verified wallet. No balance was credited.' }, 403);
    }
    if (network === 'trc20') {
      const expectedTron = await evmToTronAddress(linkedEvm);
      const expectedTronHex = '41' + linkedEvm.slice(2).toLowerCase();
      const actualTron = String(verified.from || '');
      if (!expectedTron || (actualTron !== expectedTron && actualTron.toLowerCase() !== expectedTronHex)) {
        return c.json({ error: 'TRON sender does not match the TRON address derived from your linked wallet. No balance was credited.' }, 403);
      }
    }
    const amount = String(verified.amount);
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return c.json({ error: 'Invalid on-chain transfer amount.' }, 400);
    await ensureDepositSwapTables(c.env.DB);
    const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO crypto_deposits (user_id, network, tx_hash, amount, token, from_address, to_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, network, normalizedHash, amount, verified.token || (network === 'ton' ? 'TON' : 'USDT'), verified.from || '', verified.to, nowSec()).run();
    if ((inserted.meta?.changes ?? 0) === 0) return c.json({ error: 'This transaction has already been credited.' }, 409);
    const asset = String(verified.token || (network === 'ton' ? 'TON' : 'USDT')).toUpperCase();
    const ledgerKey = 'deposit:' + network + ':' + normalizedHash;
    const ledgerInsert = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO deposit_swap_ledger (user_id, deposit_network, deposit_tx_hash, asset, amount, entry_type, reference_type, reference_id, idempotency_key, status) VALUES (?, ?, ?, ?, ?, 'deposit', 'crypto_deposit', ?, ?, 'posted')"
    ).bind(userId, network, normalizedHash, asset, amount, normalizedHash, ledgerKey).run();
    const ledger = await c.env.DB.prepare(
      "SELECT id FROM deposit_swap_ledger WHERE idempotency_key = ?"
    ).bind(ledgerKey).first<any>();
    if (ledger?.id) {
      const requestKey = 'swap:' + network + ':' + normalizedHash;
      await c.env.DB.prepare(
        "INSERT OR IGNORE INTO deposit_swap_orders (user_id, ledger_deposit_id, request_key, from_network, from_asset, from_amount, source_tx_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')"
      ).bind(userId, ledger.id, requestKey, network, asset, amount, normalizedHash).run();
    }
    const { results } = await c.env.DB.prepare('SELECT id, network, tx_hash, amount, token, created_at FROM crypto_deposits WHERE user_id = ? ORDER BY id DESC LIMIT 30').bind(userId).all();
    const totals = await c.env.DB.prepare('SELECT network, SUM(CAST(amount AS REAL)) AS amount FROM crypto_deposits WHERE user_id = ? GROUP BY network').bind(userId).all();
    const balances: any = { ton: 0, bep20: 0, trc20: 0 };
    for (const row of (totals.results || []) as any[]) balances[row.network] = Number(row.amount) || 0;
    return c.json({ success: true, amount, token: verified.token || (network === 'ton' ? 'TON' : 'USDT'), network, deposits: results || [], balances });
  } catch (e: any) { return c.json({ error: e?.message || 'Deposit verification failed' }, 400); }
});


app.post('/api/ton-proof/payload', async (c) => {
  try {
    const userId = c.get('tgUser').id;
    await ensureTonProofTables(c.env.DB);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const payload = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.DB.prepare('INSERT INTO ton_proof_challenges (user_id, payload, expires_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at')
      .bind(userId, payload, nowSec() + 300).run();
    return c.json({ payload });
  } catch (e: any) { return c.json({ error: e?.message || 'Could not create TON proof challenge' }, 500); }
});
app.post('/api/ton-proof/verify', async (c) => {
  try {
    const userId = c.get('tgUser').id;
    const body = await c.req.json().catch(() => ({}));
    await ensureTonProofTables(c.env.DB);
    const challenge = await c.env.DB.prepare('SELECT payload, expires_at FROM ton_proof_challenges WHERE user_id = ?').bind(userId).first<any>();
    if (!challenge || Number(challenge.expires_at) < nowSec()) return c.json({ error: 'TON wallet challenge expired. Reconnect.' }, 401);
    const expectedDomain = new URL(c.req.url).hostname;
    const verified = await verifyTonConnectProof(body, expectedDomain, String(challenge.payload));
    const consumed = await c.env.DB.prepare('DELETE FROM ton_proof_challenges WHERE user_id = ? AND payload = ? AND expires_at >= ?').bind(userId, challenge.payload, nowSec()).run();
    if ((consumed.meta?.changes ?? 0) !== 1) return c.json({ error: 'TON proof challenge has already been used. Reconnect.' }, 409);
    await c.env.DB.prepare('INSERT INTO ton_wallet_links (user_id, address_raw, address_friendly, public_key, network, verified_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET address_raw = excluded.address_raw, address_friendly = excluded.address_friendly, public_key = excluded.public_key, network = excluded.network, verified_at = excluded.verified_at')
      .bind(userId, verified.addressRaw, verified.addressFriendly, verified.publicKey, verified.network, nowSec()).run();
    return c.json({ success: true, address: verified.addressFriendly, address_raw: verified.addressRaw });
  } catch (e: any) { return c.json({ error: e?.message || 'TON wallet proof verification failed' }, 401); }
});
app.get('/api/ton-wallet', async (c) => {
  await ensureTonProofTables(c.env.DB);
  const linked = await c.env.DB.prepare('SELECT address_friendly, address_raw, verified_at FROM ton_wallet_links WHERE user_id = ?').bind(c.get('tgUser').id).first<any>();
  return c.json({ wallet: linked || null });
});
app.post('/api/ton-wallet/disconnect', async (c) => {
  await ensureTonProofTables(c.env.DB);
  await c.env.DB.prepare('DELETE FROM ton_wallet_links WHERE user_id = ?').bind(c.get('tgUser').id).run();
  return c.json({ success: true });
});

app.post('/api/wallet/challenge', async (c) => {
  try {
    const tgUser = c.get('tgUser');
    const body = await c.req.json().catch(() => ({}));
    const address = String(body.address || '').trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return c.json({ error: 'Invalid EVM address' }, 400);
    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS wallet_signin_challenges (
      user_id TEXT NOT NULL, address TEXT NOT NULL, nonce TEXT NOT NULL,
      expires_at INTEGER NOT NULL, PRIMARY KEY (user_id, address)
    )`).run();
    const nonce = crypto.randomUUID();
    const issuedAt = nowSec();
    const expiresAt = issuedAt + 300;
    const message = `HYPE App wallet sign-in\nTelegram User ID: ${tgUser.id}\nWallet: ${address}\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt * 1000).toISOString()}\nThis signature only proves wallet ownership. It does not authorize transactions.`;
    await c.env.DB.prepare('INSERT INTO wallet_signin_challenges (user_id, address, nonce, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, address) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at')
      .bind(String(tgUser.id), address.toLowerCase(), nonce, expiresAt).run();
    return c.json({ message, expiresAt });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Could not create sign-in challenge' }, 500);
  }
});

app.post('/api/wallet/verify', async (c) => {
  try {
    const tgUser = c.get('tgUser');
    const body = await c.req.json().catch(() => ({}));
    const address = String(body.address || '').trim();
    const signature = String(body.signature || '').trim();
    const message = String(body.message || '');
    if (!/^0x[a-fA-F0-9]{40}$/.test(address) || !/^0x[a-fA-F0-9]{130}$/.test(signature) || !message)
      return c.json({ error: 'Invalid wallet signature request' }, 400);
    const challenge = await c.env.DB.prepare('SELECT nonce, expires_at FROM wallet_signin_challenges WHERE user_id = ? AND address = ?')
      .bind(String(tgUser.id), address.toLowerCase()).first<{ nonce: string; expires_at: number }>();
    if (!challenge || Number(challenge.expires_at) < nowSec()) return c.json({ error: 'Sign-in request expired. Please reconnect.' }, 401);
    if (!message.includes(`Telegram User ID: ${tgUser.id}`) || !message.includes(`Wallet: ${address}`) || !message.includes(`Nonce: ${challenge.nonce}`))
      return c.json({ error: 'Sign-in message mismatch' }, 401);
    const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    if (recovered.toLowerCase() !== address.toLowerCase()) return c.json({ error: 'Wallet signature does not match address' }, 401);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM wallet_signin_challenges WHERE user_id = ? AND address = ? AND nonce = ?').bind(String(tgUser.id), address.toLowerCase(), challenge.nonce),
      c.env.DB.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').bind(address, tgUser.id),
    ]);
    return c.json({ success: true, wallet_address: address });
  } catch (e: any) {
    return c.json({ error: e?.message || 'Wallet signature verification failed' }, 400);
  }
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
    if (addr) return c.json({ error: 'Wallet ownership must be verified with a signature. Please reconnect your wallet.' }, 403);
    await c.env.DB.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').bind('', tgUser.id).run();
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


// Monetag rewarded-interstitial: credit only from Monetag's signed-secret server postback.
async function ensureAdTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS monetag_ad_events (
    ymid TEXT PRIMARY KEY, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    reward REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    credited_at INTEGER
  )`).run();
}
app.get('/api/ads/usage', async (c) => {
  const u = c.get('tgUser');
  await ensureAdTables(c.env.DB);
  const since = nowSec() - 86400;
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total, MIN(created_at) AS oldest FROM monetag_ad_events WHERE user_id = ? AND created_at > ?'
  ).bind(u.id, since).first<any>();
  const used = Number(row?.total) || 0;
  const retryAfter = used >= 1000 ? Math.max(0, (Number(row?.oldest) || nowSec()) + 86400 - nowSec()) : 0;
  return c.json({ daily_limit: 1000, ads_used: used, ads_remaining: Math.max(0, 1000 - used), retry_after: retryAfter });
});
app.post('/api/ads/start', async (c) => {
  const cfg = await getConfig(c.env.DB, c.env);
  if (!cfg.ads_enabled) return c.json({ error: 'Ads are currently disabled.' }, 403);
  const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
  await ensureAdTables(c.env.DB);
  const ymid = 'hype_' + u.id + '_' + crypto.randomUUID().replace(/-/g, '');
  const started = await c.env.DB.prepare(
    `INSERT INTO monetag_ad_events (ymid, user_id, status, reward)
     SELECT ?, ?, 'pending', ?
     WHERE (SELECT COUNT(*) FROM monetag_ad_events WHERE user_id = ? AND created_at > ?) < 1000`
  ).bind(ymid, u.id, cfg.ad_reward, u.id, nowSec() - 86400).run();
  if ((started.meta?.changes ?? 0) !== 1) {
    const used = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM monetag_ad_events WHERE user_id = ? AND created_at > ?')
      .bind(u.id, nowSec() - 86400).first<any>();
    const oldest = await c.env.DB.prepare('SELECT MIN(created_at) AS oldest FROM monetag_ad_events WHERE user_id = ? AND created_at > ?')
      .bind(u.id, nowSec() - 86400).first<any>();
    const retryAfter = Math.max(1, (Number(oldest?.oldest) || nowSec()) + 86400 - nowSec());
    return c.json({ error: 'Daily ad limit reached. You can watch more ads after the 24-hour limit resets.', daily_limit: 1000, ads_used: Number(used?.total) || 1000, retry_after: retryAfter }, 429);
  }
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS total FROM monetag_ad_events WHERE user_id = ? AND created_at > ?')
    .bind(u.id, nowSec() - 86400).first<any>();
  return c.json({ ymid, reward: cfg.ad_reward, daily_limit: 1000, ads_used: Number(used?.total) || 1, ads_remaining: Math.max(0, 1000 - (Number(used?.total) || 1)) });
});
app.get('/api/ads/history', async (c) => {
  const u = c.get('tgUser');
  await ensureAdTables(c.env.DB);
  const { results } = await c.env.DB.prepare(
    'SELECT ymid, status, reward, created_at, credited_at FROM monetag_ad_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(u.id).all<any>();
  return c.json({ history: (results || []).map((row: any) => ({
    ymid: row.ymid,
    status: row.status === 'credited' ? 'credited' : 'pending',
    reward: Number(row.reward) || 0,
    created_at: Number(row.created_at) || 0,
    credited_at: Number(row.credited_at) || 0,
  })) });
});
app.get('/api/ads/status/:ymid', async (c) => {
  await ensureAdTables(c.env.DB);
  const row = await c.env.DB.prepare('SELECT status, reward FROM monetag_ad_events WHERE ymid = ? AND user_id = ?')
    .bind(c.req.param('ymid'), c.get('tgUser').id).first<any>();
  if (!row) return c.json({ error: 'Ad session not found.' }, 404);
  return c.json({ status: row.status, reward: Number(row.reward) || 0 });
});
app.get('/api/monetag/postback', async (c) => {
  const secret = String(c.env.MONETAG_POSTBACK_SECRET || '');
  if (!secret || c.req.query('secret') !== secret) return c.text('Unauthorized', 401);
  const ymid = String(c.req.query('ymid') || '');
  const eventType = String(c.req.query('event_type') || '');
  const rewardType = String(c.req.query('reward_event_type') || '');
  const zoneId = String(c.req.query('zone_id') || '');
  if (!/^hype_[1-9][0-9]*_[a-f0-9]{32}$/.test(ymid)) return c.text('Invalid ymid', 400);
  if (zoneId !== '12178167') return c.text('Invalid zone_id', 400);
  if (eventType !== 'impression' && eventType !== 'click') return c.text('Invalid event_type', 400);
  if (rewardType !== 'valued') return c.text('Ignored: non-valued event', 200);
  await ensureAdTables(c.env.DB);
  const event = await c.env.DB.prepare("SELECT user_id, reward FROM monetag_ad_events WHERE ymid = ? AND status = 'pending'").bind(ymid).first<any>();
  if (!event) return c.text('Already processed or unknown event', 200);
  const result = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE monetag_ad_events SET status = 'credited', credited_at = ? WHERE ymid = ? AND status = 'pending'").bind(nowSec(), ymid),
    c.env.DB.prepare("UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ? AND changes() > 0").bind(Number(event.reward), Number(event.reward), Number(event.user_id)),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) return c.text('Duplicate', 200);
  return c.text('OK', 200);
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

async function checkTelegramTaskMembership(db: D1Database, env: Bindings, userId: number, taskId: number, isPremium?: boolean) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ? AND is_active = 1').bind(taskId).first<any>();
  if (!task) return { error: 'Task not found', status: 404 };
  const taskType = String(task.type || '').toLowerCase();
  if (taskType === 'youtube' || taskType === 'link') {
    return { task, manual: true, isMember: false };
  }
  if (taskType === 'boost') {
    // Premium-only task: verify the exact bot, channel admin access, and active user boosts.
    if (!isPremium) {
      return { error: 'This boost task is only available for Telegram Premium users', status: 403 };
    }
    if (!env.BOT_TOKEN) return { error: 'Telegram bot token is not configured', status: 503 };
    const match = String(task.link || '').trim().match(/(?:https?:\\/\\/)?(?:www\\.)?t\\.me\\/(?:boost\\/)?([A-Za-z0-9_]{5,})\\/?(?:[?#].*)?$|^@([A-Za-z0-9_]{5,})$/i);
    const channel = match?.[1] ? `@${match[1]}` : match?.[2] ? `@${match[2]}` : '';
    if (!channel) return { error: 'Boost task link must be a public Telegram channel link or @username (example: https://t.me/boost/channelname)', status: 422 };

    const telegramCall = async (method: string, params: Record<string, string | number>) => {
      const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
      const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}?${query.toString()}`);
      const data: any = await response.json().catch(() => ({}));
      return data;
    };

    // Resolve the configured channel first so subsequent checks use its numeric chat ID.
    const me = await telegramCall('getMe', {});
    if (!me?.ok || !me.result?.id) {
      return { error: `Telegram bot token check failed: ${me?.description || 'getMe was not successful'}`, status: 503 };
    }
    const chat = await telegramCall('getChat', { chat_id: channel });
    if (!chat?.ok || !chat.result?.id) {
      return { error: `Cannot access boost channel ${channel}: ${chat?.description || 'Telegram getChat failed'}. Check the task link and make sure this exact bot is added to that channel.`, status: 503 };
    }

    // Confirm that the bot configured by BOT_TOKEN (not another bot) is an admin.
    const botMember = await telegramCall('getChatMember', { chat_id: chat.result.id, user_id: me.result.id });
    if (!botMember?.ok) {
      return { error: `Could not check bot admin status in ${chat.result.title || channel}: ${botMember?.description || 'Telegram getChatMember failed'}`, status: 503 };
    }
    if (!['creator', 'administrator'].includes(String(botMember.result?.status || ''))) {
      return { error: `The configured bot @${me.result.username || 'unknown'} is not an administrator in ${chat.result.title || channel}. Add this exact bot as channel admin.`, status: 503 };
    }
    if (botMember.result.status === 'administrator' && botMember.result.can_manage_chat === false) {
      return { error: `Bot @${me.result.username || 'unknown'} is admin, but its Manage Chat permission is disabled in ${chat.result.title || channel}. Enable Manage Chat for the bot.`, status: 503 };
    }

    // Telegram only returns boosts that this user applied to this channel.
    const boostResult = await telegramCall('getUserChatBoosts', { chat_id: chat.result.id, user_id: userId });
    if (!boostResult?.ok) {
      return { error: `Telegram boost verification failed for ${chat.result.title || channel}: ${boostResult?.description || 'getUserChatBoosts failed'}`, status: 503 };
    }
    const now = nowSec();
    const boosts = Array.isArray(boostResult.result?.boosts)
      ? boostResult.result.boosts.filter((boost: any) => Number(boost?.expiration_date || 0) > now)
      : [];
    return { task, isMember: boosts.length > 0, isBoost: true, boostCount: boosts.length };
  }
  if (taskType !== 'telegram') return { error: 'Unsupported task type', status: 422 };
  if (!env.BOT_TOKEN) return { error: 'Telegram bot token is not configured', status: 503 };
  const match = String(task.link || '').trim().match(/(?:https?:\/\/)?(?:www\.)?t\.me\/([A-Za-z0-9_]{5,})|^@([A-Za-z0-9_]{5,})$/i);
  const channel = match?.[1] ? `@${match[1]}` : match?.[2] ? `@${match[2]}` : '';
  if (!channel) return { error: 'Task link must be a public Telegram channel link or @username', status: 422 };
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(channel)}&user_id=${userId}`);
  const result: any = await response.json();
  if (!result?.ok) return { error: 'Could not verify channel membership. The bot must be an admin in that channel.', status: 503 };
  const member = result.result;  const isMember = member && (['creator', 'administrator', 'member'].includes(member.status) || (member.status === 'restricted' && member.is_member === true));
  return { task, isMember: !!isMember };
}

app.post('/api/tasks/verify', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const taskId = Number(body.task_id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return c.json({ error: 'Invalid task id' }, 400);
    const userId = c.get('tgUser').id;
    const isPremium = Boolean(c.get('tgUser')?.is_premium);
    const check: any = await checkTelegramTaskMembership(c.env.DB, c.env, userId, taskId, isPremium);
    if (check.error) return c.json({ error: check.error }, check.status);
    const claimed = await c.env.DB.prepare('SELECT 1 FROM user_tasks WHERE user_id = ? AND task_id = ?').bind(userId, taskId).first();
    if (check.manual) {
      if (claimed) return c.json({ verified: true, claimed: true, manual: true });
      await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS youtube_task_visits (user_id INTEGER NOT NULL, task_id INTEGER NOT NULL, returned_at INTEGER NOT NULL, PRIMARY KEY (user_id, task_id))').run();
      const now = nowSec();
      await c.env.DB.prepare('INSERT OR IGNORE INTO youtube_task_visits (user_id, task_id, returned_at) VALUES (?, ?, ?)').bind(userId, taskId, now).run();
      const visit = await c.env.DB.prepare('SELECT returned_at FROM youtube_task_visits WHERE user_id = ? AND task_id = ?').bind(userId, taskId).first<any>();
      const wait = Math.max(0, 5 - (now - Number(visit?.returned_at || now)));
      return c.json({ verified: wait === 0, claimed: false, manual: true, wait_seconds: wait });
    }
    const msg = check.isBoost
      ? (check.isMember ? `Boost verified (${check.boostCount} active)` : 'Boost the channel first (Telegram Premium required)')
      : (check.isMember ? 'Membership verified' : 'Join the channel first');
    return c.json({ verified: check.isMember, claimed: !!claimed || !!check.claimed, manual: false, message: msg, is_boost: !!check.isBoost });
  } catch (e: any) { return c.json({ error: e?.message || 'Task verification failed' }, 400); }
});

app.post('/api/tasks/complete', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const taskId = Number(body.task_id);
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return c.json({ error: 'Invalid task id' }, 400);
    const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
    const isPremium = Boolean(c.get('tgUser')?.is_premium);
    const check: any = await checkTelegramTaskMembership(c.env.DB, c.env, u.id, taskId, isPremium);
    if (check.error) return c.json({ error: check.error }, check.status);
    if (check.manual) {
      await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS youtube_task_visits (user_id INTEGER NOT NULL, task_id INTEGER NOT NULL, returned_at INTEGER NOT NULL, PRIMARY KEY (user_id, task_id))').run();
      const visit = await c.env.DB.prepare('SELECT returned_at FROM youtube_task_visits WHERE user_id = ? AND task_id = ?').bind(u.id, taskId).first<any>();
      if (!visit || nowSec() - Number(visit.returned_at) < 5) return c.json({ error: 'Return to HYPE Tap and wait 5 seconds before claiming.' }, 403);
    } else if (!check.isMember) {
      return c.json({ error: check.isBoost ? 'Boost the channel first (Telegram Premium required)' : 'Join the Telegram channel first. The bot must be an admin in that channel.' }, 403);
    }
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
    'SELECT id, username, first_name, balance, total_earned, total_taps, invite_count FROM users ORDER BY balance DESC, total_earned DESC, id ASC LIMIT 100'
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
    await ensureWithdrawalTxColumn(c.env.DB);
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

app.get('/api/history', async (c) => {
  await ensureWithdrawalTxColumn(c.env.DB);
  const userId = c.get('tgUser').id;
  await ensureActivityTables(c.env.DB);
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM (
      SELECT d.id, 'deposit' AS type, d.token AS asset, d.amount AS amount, d.network AS network,
        d.tx_hash AS tx_hash, 'completed' AS status, d.created_at AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, d.from_address AS from_address,
        d.to_address AS to_address, '' AS to_asset, '' AS to_amount
      FROM crypto_deposits d JOIN users u ON u.id = d.user_id WHERE d.user_id = ?
      UNION ALL
      SELECT w.id, 'withdrawal' AS type, 'HYPE' AS asset, CAST(w.amount AS TEXT) AS amount, 'HyperEVM' AS network,
        w.tx_hash AS tx_hash, w.status AS status, CAST(strftime('%s', w.created_at) AS INTEGER) AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, '' AS from_address,
        w.wallet_address AS to_address, '' AS to_asset, '' AS to_amount
      FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.user_id = ?
      UNION ALL
      SELECT s.id, 'swap' AS type, s.from_asset AS asset, s.from_amount AS amount, 'Swap' AS network,
        s.tx_hash AS tx_hash, s.status AS status, s.created_at AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, '' AS from_address,
        '' AS to_address, s.to_asset AS to_asset, s.to_amount AS to_amount
      FROM swap_history s JOIN users u ON u.id = s.user_id WHERE s.user_id = ?
    ) ORDER BY created_at DESC LIMIT 100
  `).bind(userId, userId, userId).all();
  return c.json({ history: results || [] });
});
app.get('/api/admin/history', async (c) => {
  await ensureWithdrawalTxColumn(c.env.DB);
  await ensureActivityTables(c.env.DB);
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM (
      SELECT d.id, 'deposit' AS type, d.token AS asset, d.amount AS amount, d.network AS network,
        d.tx_hash AS tx_hash, 'completed' AS status, d.created_at AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, d.from_address AS from_address,
        d.to_address AS to_address, '' AS to_asset, '' AS to_amount
      FROM crypto_deposits d JOIN users u ON u.id = d.user_id
      UNION ALL
      SELECT w.id, 'withdrawal' AS type, 'HYPE' AS asset, CAST(w.amount AS TEXT) AS amount, 'HyperEVM' AS network,
        w.tx_hash AS tx_hash, w.status AS status, CAST(strftime('%s', w.created_at) AS INTEGER) AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, '' AS from_address,
        w.wallet_address AS to_address, '' AS to_asset, '' AS to_amount
      FROM withdrawals w JOIN users u ON u.id = w.user_id
      UNION ALL
      SELECT s.id, 'swap' AS type, s.from_asset AS asset, s.from_amount AS amount, 'Swap' AS network,
        s.tx_hash AS tx_hash, s.status AS status, s.created_at AS created_at,
        u.id AS user_id, u.username, u.first_name, u.last_name, '' AS from_address,
        '' AS to_address, s.to_asset AS to_asset, s.to_amount AS to_amount
      FROM swap_history s JOIN users u ON u.id = s.user_id
    ) ORDER BY created_at DESC LIMIT 300
  `).all();
  return c.json({ history: results || [] });
});

app.get('/api/withdrawals', async (c) => {
  await ensureWithdrawalTxColumn(c.env.DB);
  const authUser = c.get('tgUser');
  const { results } = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(authUser.id).all();
  return c.json({ withdrawals: results || [] });
});

app.post('/api/withdrawals', async (c) => {
  try {
    await ensureWithdrawalTxColumn(c.env.DB);
    const u = await ensureUser(c.env.DB, c.env, c.get('tgUser'), null);
    const { results } = await c.env.DB.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 50').bind(u.id).all();
    return c.json({ withdrawals: results || [] });
  } catch { return c.json({ withdrawals: [] }); }
});

// Admin

app.get('/api/admin/deposit-swaps', async (c) => {
  await ensureDepositSwapTables(c.env.DB);
  const status = String(c.req.query('status') || 'queued');
  const allowed = ['queued','processing','submitted','completed','failed','refunded','all'];
  if (!allowed.includes(status)) return c.json({ error: 'Invalid status filter' }, 400);
  const where = status === 'all' ? '' : 'WHERE o.status = ?';
  const query = `SELECT o.id, o.user_id, u.username, u.first_name, o.from_network, o.from_asset,
    o.from_amount, o.to_asset, o.status, o.source_tx_hash, o.swap_tx_hash, o.error_code,
    o.error_message, o.created_at, o.updated_at
    FROM deposit_swap_orders o LEFT JOIN users u ON u.id = o.user_id ${where}
    ORDER BY o.id DESC LIMIT 200`;
  const result = status === 'all'
    ? await c.env.DB.prepare(query).all()
    : await c.env.DB.prepare(query).bind(status).all();
  return c.json({ orders: result.results || [] });
});
app.post('/api/admin/deposit-swaps/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const action = String(body.action || '');
  if (!Number.isSafeInteger(id) || id <= 0 || !['approve','reject','complete'].includes(action)) return c.json({ error: 'Invalid deposit swap action' }, 400);
  await ensureDepositSwapTables(c.env.DB);
  if (action === 'complete') {
    const order = await c.env.DB.prepare("SELECT o.* FROM deposit_swap_orders o WHERE o.id = ? AND o.status = 'processing'").bind(id).first<any>();
    if (!order) return c.json({ error: 'Swap must be approved and processing before settlement.' }, 409);
    const treasury = String(c.env.HYPE_TREASURY_ADDRESS || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(treasury)) return c.json({ error: 'Configure HYPE_TREASURY_ADDRESS in Cloudflare Worker variables before settling swaps.' }, 503);
    const hypeAmount = String(body.hype_amount || '').trim();
    let transfer: any;
    try { transfer = await verifyHyperevmNativeTransfer(c.env, String(body.tx_hash || ''), treasury, hypeAmount); }
    catch (e: any) { return c.json({ error: e?.message || 'Could not verify HYPE settlement.' }, 400); }
    const amount = Number(hypeAmount);
    if (!Number.isFinite(amount) || amount <= 0 || Number(transfer.amount) + 1e-18 < amount) return c.json({ error: 'Verified transfer does not cover the HYPE amount.' }, 400);
    await ensureActivityTables(c.env.DB);
    const ledgerKey = 'swap-credit:order:' + id;
    const results = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE deposit_swap_orders SET status = 'completed', received_hype_amount = ?, swap_tx_hash = ?, provider = 'manual-hyperevm-settlement', error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status = 'processing'").bind(hypeAmount, transfer.tx_hash, nowSec(), id),
      c.env.DB.prepare("INSERT OR IGNORE INTO deposit_swap_ledger (user_id, deposit_network, deposit_tx_hash, asset, amount, entry_type, reference_type, reference_id, idempotency_key, status) SELECT user_id, from_network, source_tx_hash, 'HYPE', ?, 'swap_credit', 'deposit_swap_order', ?, ?, 'posted' FROM deposit_swap_orders WHERE id = ? AND status = 'completed' AND changes() > 0").bind(hypeAmount, String(id), ledgerKey, id),
      c.env.DB.prepare("UPDATE users SET balance = balance + ? WHERE id = (SELECT user_id FROM deposit_swap_orders WHERE id = ?) AND changes() > 0").bind(amount, id),
      c.env.DB.prepare("INSERT INTO swap_history (user_id, from_asset, to_asset, from_amount, to_amount, tx_hash, status, created_at) SELECT user_id, from_asset, 'HYPE', from_amount, ?, ?, 'completed', ? FROM deposit_swap_orders WHERE id = ? AND status = 'completed' AND changes() > 0").bind(hypeAmount, transfer.tx_hash, nowSec(), id)
    ]);
    if ((results[0]?.meta?.changes ?? 0) !== 1) return c.json({ error: 'Swap order was settled by another request.' }, 409);
    return c.json({ success: true, status: 'completed', hype_amount: hypeAmount, tx_hash: transfer.tx_hash });
  }
  const nextStatus = action === 'approve' ? 'processing' : 'failed';
  const result = await c.env.DB.prepare("UPDATE deposit_swap_orders SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(nextStatus, action === 'approve' ? null : 'ADMIN_REJECTED',
      action === 'approve' ? 'Approved. Complete the external conversion and submit the confirmed HYPE transfer to the configured treasury.' : 'Rejected by admin. The source deposit remains in the deposit wallet and must be refunded manually.',
      nowSec(), id).run();
  if ((result.meta?.changes ?? 0) !== 1) return c.json({ error: 'Order is no longer awaiting approval.' }, 409);
  return c.json({ success: true, status: nextStatus, swap_executed: false });
});

app.get('/api/admin/stats', async (c) => {
  const users = (await c.env.DB.prepare('SELECT COUNT(*) AS c FROM users').first<any>())?.c || 0;
  const earned = (await c.env.DB.prepare('SELECT SUM(total_earned) AS s FROM users').first<any>())?.s || 0;
  const totalBal = (await c.env.DB.prepare('SELECT SUM(balance) AS s FROM users').first<any>())?.s || 0;
  const pending = (await c.env.DB.prepare("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'pending'").first<any>())?.c || 0;
  return c.json({ total_users: users, users, total_earned: earned, earned, total_balance: totalBal, pending_withdrawals: pending });
});

app.get('/api/admin/withdrawals', async (c) => {
  await ensureWithdrawalTxColumn(c.env.DB);
  const status = c.req.query('status') || 'pending';
  if (!['pending', 'processing', 'approved', 'rejected'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, u.username, u.first_name FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.id DESC LIMIT 100`
  ).bind(status).all();
  return c.json({ withdrawals: results || [] });
});

app.post('/api/admin/withdrawals/:id', async (c) => {
  await ensureWithdrawalTxColumn(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const action = String(body.action || '');
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid withdrawal id' }, 400);
  if (action === 'approve') {
    const wd = await c.env.DB.prepare("SELECT * FROM withdrawals WHERE id = ? AND status IN ('pending','processing')").bind(id).first<any>();
    if (!wd) return c.json({ error: 'Withdrawal not found or already processed.' }, 409);
    const treasury = String(c.env.HYPE_TREASURY_ADDRESS || '').trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(treasury)) return c.json({ error: 'Configure HYPE_TREASURY_ADDRESS in Cloudflare Worker variables before confirming payouts.' }, 503);
    let transfer: any;
    try { transfer = await verifyHyperevmNativeTransfer(c.env, String(body.tx_hash || ''), String(wd.wallet_address || ''), String(wd.amount), treasury); }
    catch (e: any) { return c.json({ error: e?.message || 'Could not verify HYPE payout.' }, 400); }
    const result = await c.env.DB.prepare("UPDATE withdrawals SET status = 'approved', tx_hash = ?, processed_at = ? WHERE id = ? AND status IN ('pending','processing') AND tx_hash = ''").bind(transfer.tx_hash, nowSec(), id).run();
    if ((result.meta?.changes ?? 0) !== 1) return c.json({ error: 'Withdrawal was already settled or changed.' }, 409);
    return c.json({ success: true, status: 'approved', tx_hash: transfer.tx_hash });
  }
  if (!['reject','processing'].includes(action)) return c.json({ error: 'Invalid action' }, 400);
  const status = action === 'reject' ? 'rejected' : 'processing';
  const statements = [
    c.env.DB.prepare("UPDATE withdrawals SET status = ?, processed_at = CASE WHEN ? = 'rejected' THEN strftime('%s','now') ELSE processed_at END WHERE id = ? AND status IN ('pending','processing')").bind(status, status, id),
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
  const telegramChannel = /^(?:https?:\/\/)?(?:www\.)?t\.me\/(?:boost\/)?[A-Za-z0-9_]{5,}\/?$|^@[A-Za-z0-9_]{5,}$/i.test(link);
  const youtubeLink = /^(https?:\/\/)?(www\.)?(youtube\.com\/(channel\/|@|c\/|user\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_?&=.-]+/i.test(link);
  const validLink =
    ((type === 'telegram' || type === 'boost') && telegramChannel) ||
    (type === 'youtube' && youtubeLink);
  if (!title || !validLink || !['telegram', 'youtube', 'boost'].includes(type) || !Number.isFinite(reward) || reward < 0 || reward > 1000000) {
    return c.json({ error: 'Enter a valid public t.me (for telegram/boost) or YouTube link, title and reward' }, 400);
  }
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
  const bounds: Record<string, [number, number]> = { tap_reward: [0, 1000000], referral_reward: [0, 1000000], min_withdraw: [0.00000001, 1000000], energy_max: [1, 1000000], energy_cooldown: [60, 604800], daily_checkin_reward: [0, 1000000], streak_bonus: [0, 1000000], ad_reward: [0, 1000000] };
  const values: Array<[string, string]> = [];
  for (const [k, [minValue, maxValue]] of Object.entries(bounds)) {
    if (b[k] === undefined || b[k] === null || b[k] === '') continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < minValue || n > maxValue) return c.json({ error: `Invalid ${k}` }, 400);
    values.push([k, String(n)]);
  }
  if (b.ads_enabled !== undefined) {
    if (typeof b.ads_enabled !== 'boolean') return c.json({ error: 'Invalid ads_enabled' }, 400);
    values.push(['ads_enabled', b.ads_enabled ? '1' : '0']);
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
  const { results } = await c.env.DB.prepare('SELECT id, username, first_name, balance, total_earned, total_taps, invite_count, is_admin FROM users ORDER BY balance DESC, total_earned DESC, id ASC LIMIT ?').bind(limit).all();
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
  try {
    const b = await c.req.json().catch(() => null);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return c.json({ error: 'Invalid request body' }, 400);
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid user id' }, 400);

    const fields: Record<string, number> = {};
    for (const k of ['balance', 'total_earned', 'total_taps', 'invite_count'] as const) {
      if (b[k] === undefined || b[k] === null || b[k] === '') continue;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1e15 ||
          ((k === 'total_taps' || k === 'invite_count') && !Number.isSafeInteger(n))) {
        return c.json({ error: `Invalid ${k}` }, 400);
      }
      fields[k] = n;
    }
    if (b.is_admin !== undefined && typeof b.is_admin !== 'boolean' && b.is_admin !== 0 && b.is_admin !== 1) {
      return c.json({ error: 'Invalid is_admin' }, 400);
    }

    const exists = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first<any>();
    if (!exists) return c.json({ error: 'User not found' }, 404);

    const updates: string[] = [];
    const values: number[] = [];
    for (const key of ['balance', 'total_earned', 'total_taps', 'invite_count'] as const) {
      if (fields[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(fields[key]);
      }
    }
    if (b.is_admin !== undefined) {
      updates.push('is_admin = ?');
      values.push(b.is_admin ? 1 : 0);
    }
    if (updates.length) {
      await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values, id).run();
    }
    const updated = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<any>();
    if (!updated) return c.json({ error: 'User not found after update' }, 404);
    return c.json({ success: true, user: publicUser(updated, c.env) });
  } catch (e: any) {
    console.error('Admin user update failed:', e?.stack || e?.message || e);
    return c.json({ error: e?.message || 'User update failed' }, 500);
  }
});
app.delete('/api/admin/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.json({ error: 'Invalid user id' }, 400);
  if (id === c.get('tgUser').id || adminSet(c.env).has(id)) return c.json({ error: 'Cannot delete your own account or a configured administrator' }, 403);
  const target = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(id).first<any>();
  if (!target) return c.json({ error: 'User not found' }, 404);
  if (Number(target.is_admin) === 1) return c.json({ error: 'Cannot delete an administrator account' }, 403);
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