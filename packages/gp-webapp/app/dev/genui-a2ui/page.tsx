import { notFound } from 'next/navigation'
import { IS_PREVIEW } from 'appEnv'
import GenUiA2uiPlayground from './GenUiA2uiPlayground'

export default function GenUiA2uiPage() {
  if (process.env.NODE_ENV !== 'development' && !IS_PREVIEW) notFound()
  return <GenUiA2uiPlayground />
}
