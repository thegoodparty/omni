import { UnsubscribePage } from './UnsubscribePage'

export const metadata = {
  title: 'Unsubscribe',
  robots: 'noindex',
  referrer: 'no-referrer',
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <UnsubscribePage token={token} />
}
