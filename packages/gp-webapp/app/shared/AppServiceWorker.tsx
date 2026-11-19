import { SerwistProvider } from '@serwist/next/react'

// Registers the Serwist service worker (public/sw.js, built by the
// `serwist build` step). Disabled under `next dev`, where no SW is
// generated — mirrors next-pwa's old dev-disable behavior.
//
// `reloadOnOnline` defaults to true, and reloads every page the moment
// signal returns, worker or none. That ends a door-knocking walk, which
// lives in the page's state, and cuts off the offline queue's upload, which
// starts on that same `online` event. Nothing needs the reload: React
// Query refetches on reconnect, and a page the worker served from its cache
// while offline is replaced on the next navigation.
const AppServiceWorker = (): React.JSX.Element => (
  <SerwistProvider
    swUrl="/sw.js"
    disable={process.env.NODE_ENV !== 'production'}
    reloadOnOnline={false}
  />
)

export default AppServiceWorker
