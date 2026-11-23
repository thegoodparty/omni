'use client'
import { SerwistProvider } from '@serwist/next/react'
import { faro, LogLevel } from '@grafana/faro-web-sdk'
import { useEffect } from 'react'

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
//
// A refused registration is not an exception we threw. `register()` rejects
// with a DOMException the browser raises itself, carrying no stack frame
// (ENG-11671, 2026-11-17T14:10:48Z: `SecurityError: ... The script resource
// is behind a redirect, which is disallowed`), and the spec makes fatal
// conditions this app cannot change — any redirect on the script fetch is one,
// whoever sends it. Registering from `SerwistProvider`'s own `void register()`
// turns that into an unhandled promise rejection, and Faro reports every
// unhandled rejection as a new front-end exception, so a browser condition
// arrived as a Bugs-board ticket. Registration is taken over here
// (`register={false}`) to report the refusal as a log line instead: same
// stream, same session and page, no exception, and a worker that stopped
// registering for everyone stays findable, which a frame or message filter on
// the alert would have hidden.
const RegistersWorker = (): null => {
  useEffect(() => {
    // The provider above creates this instance while it renders, before this
    // component does, so it is always the one to register.
    const serwist = window.serwist
    if (!serwist) return
    void serwist.register().catch((error: unknown) => {
      faro.api?.pushLog(['Service worker registration refused', error], {
        level: LogLevel.WARN,
        context: { component: 'AppServiceWorker' },
      })
    })
  }, [])

  return null
}

const AppServiceWorker = (): React.JSX.Element => (
  <SerwistProvider
    swUrl="/sw.js"
    register={false}
    disable={process.env.NODE_ENV !== 'production'}
    reloadOnOnline={false}
  >
    <RegistersWorker />
  </SerwistProvider>
)

export default AppServiceWorker
