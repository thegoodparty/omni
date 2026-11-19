export const isEmailPublicPath = (pathname: string | null): boolean =>
  pathname?.startsWith('/email/') ?? false
