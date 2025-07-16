export const IS_PROD =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'production'
export const IS_PREVIEW =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'preview'
export const IS_DEV =
  process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV === 'development'
export const IS_LOCAL =
  Boolean(
    typeof process !== 'undefined' &&
      process?.env?.NEXT_PUBLIC_API_BASE?.includes('localhost'),
  ) ||
  Boolean(
    typeof window !== 'undefined' && window.location.href.includes('localhost'),
  )

export const API_ROOT =
  process.env.NEXT_PUBLIC_API_BASE || 'https://gp-api-qa.goodparty.org/v1'



export const API_VERSION_PREFIX = '/v1'

