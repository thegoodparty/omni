import { notFound } from 'next/navigation'
import { IS_PREVIEW } from 'appEnv'
import { GenUiPlayground } from './GenUiPlayground'

export default function GenUiJsonRenderPage() {
  if (process.env.NODE_ENV !== 'development' && !IS_PREVIEW) notFound()
  return <GenUiPlayground />
}
