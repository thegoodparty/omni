import { notFound } from 'next/navigation'
import { IS_PREVIEW } from 'appEnv'
import OpenUiPlayground from './OpenUiPlayground'

// Unlike the other dev pages this one also renders on Vercel previews, so a
// generative UI POC can be demoed there without a login.
const DevGenUiOpenUiPage = () => {
  if (process.env.NODE_ENV !== 'development' && !IS_PREVIEW) notFound()
  return <OpenUiPlayground />
}

export default DevGenUiOpenUiPage
