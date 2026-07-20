import { MARKETING_SITE_DOMAIN } from 'appEnv'

export const getMarketingUrl = (path: string): string => {
  // env values have shipped with a scheme, a mangled colon-less scheme
  // (`https//host`), and trailing slashes — normalize all of them
  const domain = MARKETING_SITE_DOMAIN.replace(/^https?:?\/\//, '').replace(
    /\/+$/,
    '',
  )
  return `https://${domain}${path.startsWith('/') ? path : `/${path}`}`
}

export const isValidUrl = (str: string): boolean => {
  const pattern = new RegExp(
    '^(https?:\\/\\/)' +
      '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' +
      '((\\d{1,3}\\.){3}\\d{1,3}))' +
      '(\\:\\d+)?(\\/[-a-z\\d%_.~+@]*)*' +
      '(\\?[;&a-z\\d%_.~+=-]*)?' +
      '(\\#[-a-z\\d_]*)?$',
    'i',
  )
  return !!pattern.test(str)
}
