export const getCookie = (name: string): string | false => {
  if (typeof window === 'undefined') {
    return false
  }
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) {
    const part = parts.pop()
    if (part) {
      return decodeURI(part.split(';').shift() ?? '')
    }
  }
  return false
}

export const setCookie = (
  name: string,
  value: string,
  days: number = 120,
): void => {
  if (typeof window === 'undefined') {
    return
  }
  let expires = ''
  if (days) {
    const date = new Date()
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
    expires = `; expires=${date.toUTCString()}`
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${
    encodeURI(value) || ''
  }${expires}; path=/; SameSite=Lax${secure}`
}

export const deleteCookies = (): void => {
  if (typeof window === 'undefined') {
    return
  }
  document.cookie.split(';').forEach((c) => {
    document.cookie = c
      .replace(/^ +/, '')
      .replace(/=.*/, `=;expires=${new Date().toUTCString()};path=/`)
  })
}

// Must mirror `setCookie`'s attributes: a cookie is identified by name AND
// path, so an expiry written without `path=/` lands on a different cookie than
// the one setCookie created and expires nothing (it only matched while the
// document happened to be at "/", which is why this looked fine in tests).
//
// Previously this wrote the value away via `setCookie(name, '', 0)` — but
// `setCookie` guards its expiry with `if (days)`, and 0 is falsy, so that left
// an empty-valued session cookie standing rather than deleting anything. Every
// caller reads through `getCookie`, which reports an empty value as `false`, so
// that behaved like a deletion; it just never was one.
export const deleteCookie = (name: string): void => {
  if (typeof window === 'undefined') {
    return
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:01 GMT; path=/; SameSite=Lax${secure}`
}
