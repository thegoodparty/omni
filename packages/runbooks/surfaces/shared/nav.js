// --- surface nav (shared) ---------------------------------------------------
//
// The same three buttons, in the same place, on every page: moving between the
// surfaces should never mean hunting for the link. The current page is marked and
// does not navigate. The console is the owner's page, so its button is hidden until
// usage.js has said who is looking (body.is-owner); on the console itself it is the
// current page and always shown.
//
// `SurfaceNav.mount(current, { feedback })` inserts the bar at the top of `.wrap`.
// With `feedback: true` it also carries the "Tell me what is missing" button, kept
// hidden until the page calls `SurfaceNav.showFeedback(true)` once the comment
// composer is known to be available.
const SurfaceNav = (() => {
  const PAGES = [
    ['explorer', 'Analytics events explorer', '__EXPLORER_URL__', false],
    ['map', 'Product map', '__MAP_URL__', false],
    ['console', 'Event health console', '__CONSOLE_URL__', true],
  ]

  const mount = (current, opts) => {
    opts = opts || {}
    const host = opts.host || document.querySelector('.wrap')
    if (!host || host.querySelector('.surfacenav')) return null

    const nav = document.createElement('nav')
    nav.className = 'surfacenav'
    nav.setAttribute('aria-label', 'Analytics surfaces')

    const pages = document.createElement('div')
    pages.className = 'surfacenav-pages'
    PAGES.forEach(([key, label, href, ownerOnly]) => {
      const a = document.createElement('a')
      a.textContent = label
      a.href = href
      if (key === current) {
        a.className = 'is-current'
        a.setAttribute('aria-current', 'page')
      } else {
        a.target = '_blank'
        a.rel = 'noreferrer'
        if (ownerOnly) a.setAttribute('data-owner-only', '')
      }
      pages.appendChild(a)
    })
    nav.appendChild(pages)

    if (opts.feedback) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'surfacenav-feedback'
      b.textContent = 'Tell me what is missing'
      b.setAttribute('data-feedback', 'nav')
      b.hidden = true
      nav.appendChild(b)
    }

    host.insertBefore(nav, host.firstChild)
    return nav
  }

  const showFeedback = (on) => {
    const b = document.querySelector('.surfacenav-feedback')
    if (b) b.hidden = !on
  }

  return { mount, showFeedback }
})()
