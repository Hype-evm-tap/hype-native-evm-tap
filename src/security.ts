import type { Context, MiddlewareHandler } from 'hono';

type SecurityEnv = {
  Bindings: {
    BOT_TOKEN?: string;
    ADMIN_ID?: string;
    ADMIN_IDS?: string;
  };
  Variables: {
    telegramUser: { id: number; username?: string; first_name?: string; last_name?: string };
  };
};

const encoder = new TextEncoder();
const MAX_AUTH_AGE_SECONDS = 60 * 60 * 24;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function validateTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const receivedHash = (params.get('hash') || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(receivedHash)) throw new Error('Invalid Telegram signature');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // Telegram Mini Apps: secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const calculatedHash = toHex(await hmac(new Uint8Array(secret), dataCheckString));
  if (!constantTimeEqual(calculatedHash, receivedHash)) throw new Error('Invalid Telegram signature');

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 60 || now - authDate > MAX_AUTH_AGE_SECONDS) {
    throw new Error('Telegram session expired. Reopen the Mini App.');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Telegram user missing');
  let user: any;
  try { user = JSON.parse(rawUser); } catch { throw new Error('Invalid Telegram user'); }
  if (!Number.isSafeInteger(Number(user?.id)) || Number(user.id) <= 0) throw new Error('Invalid Telegram user ID');
  return {
    id: Number(user.id),
    username: typeof user.username === 'string' ? user.username : undefined,
    first_name: typeof user.first_name === 'string' ? user.first_name : undefined,
    last_name: typeof user.last_name === 'string' ? user.last_name : undefined,
  };
}

function adminIds(env: SecurityEnv['Bindings']): Set<number> {
  return new Set([env.ADMIN_ID || '', env.ADMIN_IDS || '']
    .join(',').split(',').map((x) => Number(x.trim()))
    .filter((x) => Number.isSafeInteger(x) && x > 0));
}

export const telegramAuth: MiddlewareHandler<SecurityEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // These endpoints expose no user-specific or privileged data.
  if (path === '/api/health' || path === '/api/config' || path === '/api/price') return next();

  const token = c.env.BOT_TOKEN;
  if (!token) return c.json({ error: 'Server authentication is not configured' }, 503);
  const initData = c.req.header('X-Telegram-Init-Data') || c.req.header('x-telegram-init-data') || '';
  if (!initData) return c.json({ error: 'Telegram authentication required. Open this app inside Telegram.' }, 401);

  let signedUser;
  try { signedUser = await validateTelegramInitData(initData, token); }
  catch (error: any) { return c.json({ error: error?.message || 'Telegram authentication failed' }, 401); }

  // Reject client-supplied identities that differ from the signed Telegram identity.
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    try {
      const raw = await c.req.raw.clone().text();
      if (raw) {
        const body = JSON.parse(raw);
        if (body?.user?.id != null && Number(body.user.id) !== signedUser.id) {
          return c.json({ error: 'User identity mismatch' }, 403);
        }
      }
    } catch {
      return c.json({ error: 'Invalid JSON request body' }, 400);
    }
  }
  const queryUserId = c.req.query('user_id');
  if (queryUserId && Number(queryUserId) !== signedUser.id) return c.json({ error: 'User identity mismatch' }, 403);

  c.set('telegramUser', signedUser);
  await next();
};

export const requireAdmin: MiddlewareHandler<SecurityEnv> = async (c, next) => {
  const user = c.get('telegramUser');
  if (!user || !adminIds(c.env).has(user.id)) return c.json({ error: 'Admin access required' }, 403);
  await next();
};

// Use this in handlers instead of trusting body.user:
export function authenticatedTelegramUser(c: Context<SecurityEnv>) {
  return c.get('telegramUser');
}
