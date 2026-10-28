# Hype Token – Tap to Earn Telegram Mini App

Green + Gold Hyperliquid-style tap-to-earn Mini App hosted on **Cloudflare Workers + D1**.

## Features

- Tap to earn **0.000695 HYPE** per tap
- Energy system: **1000 taps** → 1 hour cooldown
- Referral: **+0.0008526 HYPE** per invite + instant notification
- Real-time HYPE price from Hyperliquid API
- Leaderboard (Top 100 + badges)
- Tasks (Telegram / YouTube) – fully managed from Admin panel
- Withdrawal with admin approval (min **1 HYPE**, no fees)
- Admin panel inside Mini App (only your Telegram ID)
- Broadcast to all users
- Permanent database (Cloudflare D1)

## Your Credentials (already configured)

- Bot: `@Hype_nativeevm_bot`
- Admin ID: `8990854464`
- Bot Token: set as Cloudflare Secret (see below)

## Deploy Steps (Cloudflare)

### 1. Prerequisites
- Node.js 18+
- Cloudflare account (free)
- Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2. Clone / upload this folder
```bash
cd hype-tap-app
npm install
cd frontend && npm install && cd ..
```

### 3. Create D1 database
```bash
npx wrangler d1 create hype-tap-db
```
Copy the `database_id` and paste it into `wrangler.toml` under `database_id = "..."`.

### 4. Apply schema
```bash
npx wrangler d1 execute hype-tap-db --file=./db/schema.sql
```

### 5. Set secrets
```bash
npx wrangler secret put BOT_TOKEN
# When prompted, paste your bot token (the one you sent me)
```

(Optional) You can also put ADMIN_ID as secret if you want.

### 6. Build frontend + Deploy
```bash
cd frontend && npm run build && cd ..
npx wrangler deploy
```

After deploy you will get a URL like:
`https://hype-tap-app.<your-subdomain>.workers.dev`

### 7. Configure Telegram Bot

1. Open @BotFather
2. `/mybots` → select `@Hype_nativeevm_bot`
3. **Bot Settings** → **Menu Button** → **Configure menu button**
4. Set URL = your Workers URL (from step 6)
5. Title = `Open Hype` or `Tap to Earn`

Also set description / about if you want.

### 8. Test
- Open the bot → click Menu button / Start
- You (admin ID 8990854464) will see **ADMIN** badge
- Other users will only see normal UI

## Local Development

```bash
# Terminal 1 – frontend
cd frontend && npm run dev

# Terminal 2 – worker (with local D1)
npx wrangler dev --local
```

For local D1 first run:
```bash
npx wrangler d1 execute hype-tap-db --local --file=./db/schema.sql
```

## Important Notes

- **Never share your bot token publicly.**
- Withdrawals are manual (you approve from Admin panel → then send HYPE from your wallet).
- Broadcast has rate limiting (35ms delay) to avoid Telegram bans. Max ~5000 users per run in this version.
- Energy & balance are permanent in D1.
- Referrals work via `?start=USER_ID` (Telegram start parameter).

## Customization

Edit values in `wrangler.toml` `[vars]`:
- `TAP_REWARD`
- `REFERRAL_REWARD`
- `MIN_WITHDRAW`
- `ENERGY_MAX`
- `ENERGY_COOLDOWN_SEC`

Then redeploy.

## Support

If you need extra features (auto-withdraw, more task types, levels, boosts, etc.) just ask.
