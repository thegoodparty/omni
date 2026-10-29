import { notFound } from 'next/navigation'
import OpenUiPlayground from './OpenUiPlayground'

// Unlike the other dev pages this one also renders on Vercel previews, so a
// generative UI POC can be demoed there without a login. VERCEL_ENV rather
// than appEnv's IS_PREVIEW: NEXT_PUBLIC_VERCEL_TARGET_ENV is not populated on
// the previews CI builds (see app/layout.tsx).
const DevGenUiOpenUiPage = () => {
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.VERCEL_ENV !== 'preview'
  ) {
    notFound()
  }
  return <OpenUiPlayground />
}

export default DevGenUiOpenUiPage
