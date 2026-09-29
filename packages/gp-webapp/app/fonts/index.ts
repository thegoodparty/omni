import localFont from 'next/font/local'

// Self-hosted rather than next/font/google. The Google loader fetches the font
// CSS at BUILD time, and `vercel build` inside the release train is the only
// place this app is ever built — no check workflow runs `next build` — so a bad
// response from Google took prod promotion down with six module-not-found
// errors on generated font CSS that named no file anyone here wrote. These are
// the same faces, taken from @fontsource-variable (which republishes the Google
// upstream), committed so a build reaches the network for nothing.
//
// One file per family, not per subset: next/font/local has no unicodeRange
// option, so it cannot express the subsetting next/font/google did. These are
// the `latin` cuts, matching the `subsets: ['latin']` the loaders asked for.
//
// Variable fonts, so one file spans every weight the apps use — Outfit's axis
// is 100-900 and Open Sans' is 300-800, both wider than anything referenced.
// Refresh them with `npm view @fontsource-variable/<family>` and copy the
// matching file out of `files/`.

export const openSans = localFont({
  src: './open-sans-latin-wght-normal.woff2',
  weight: '300 800',
  style: 'normal',
  display: 'swap',
  variable: '--open-sans-font',
  adjustFontFallback: false,
})

export const outfit = localFont({
  src: './outfit-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--outfit-font',
})

// Same file as `openSans`, exposed under the variable the briefings segment
// scopes its own typography with.
export const openSansBriefings = localFont({
  src: './open-sans-latin-wght-normal.woff2',
  weight: '300 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-briefings',
})
