/**
 * Hosts the public candidate sites are allowed to load images from.
 *
 * Single source of truth for both Next.js image optimization
 * (`next.config.ts` `images.domains`) and the server-side image-dimension
 * fetch SSRF guard (`getImageDimensions.ts`). A candidate's image URL is
 * user-controlled — it is set via gp-api `PUT /websites/mine`, whose schema
 * does not validate the host — so the server must only fetch from these known
 * asset/CDN hosts. Without this gate the server could be coerced into fetching
 * internal services or cloud metadata endpoints (CWE-918, SSRF).
 */
export const ALLOWED_IMAGE_HOSTS = [
  'assets.goodparty.org',
  'assets-dev.goodparty.org',
  'images.ctfassets.net',
  'maps.googleapis.com',
  'assets.civicengine.com',
] as const
