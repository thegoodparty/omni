import { resolve } from 'node:path'

// Vercel Authentication guards every gp-webapp preview and dev.goodparty.org.
// The browser gets past it with the bypass cookie global-setup.ts mints into
// this storage state. A cookie, not extraHTTPHeaders: that header would also
// ride every cross-origin call (gp-api, Clerk, Stripe), whose CORS preflight
// rejects an unknown header. Both helpers are no-ops when the secret is unset.
export const vercelBypassStorageState = (): string | undefined =>
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? resolve(__dirname, '../../playwright/.auth/vercel-bypass.json')
    : undefined

// For Node clients that call the webapp's own /api proxy directly.
export const vercelBypassHeaders = (): Record<string, string> => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}
