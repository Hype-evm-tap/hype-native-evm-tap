# HYPE Tap to Earn Backend

This ZIP contains the `src/index.ts` backend file supplied in the conversation.

## Important
- This is a source-code package, not a ready-to-deploy full project. It does not include the frontend, D1 schema/migrations, `package.json`, or `wrangler.toml`.
- The supplied code's `parseInitData()` does **not** verify Telegram's Web App signature, and several routes accept `body.user` directly. Do not deploy with real rewards or withdrawals until authentication and authorization are fixed.
- `getCookie` and `setCookie` are imported but unused in this source.

## Included
- `src/index.ts`
