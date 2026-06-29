import { getFlagVariants } from '@shared/experiments/getFlagVariants'

// Same-origin endpoint the client flag provider refreshes through, so flag
// resolution stays server-side (gp-api → Amplitude) and the browser never has
// to reach Amplitude itself — ad blockers and blocked networks can't affect
// gating. Mirrors the SSR seed: both go through getFlagVariants.
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const variants = (await getFlagVariants()) ?? {}
  return Response.json({ variants })
}
