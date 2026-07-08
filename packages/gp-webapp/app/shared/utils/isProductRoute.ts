export const isProductRoute = (
  pathname: string | null | undefined,
): boolean => {
  const isOnboardingPath = pathname?.startsWith('/onboarding')
  const isDashboardPath =
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/volunteer-dashboard') ||
    pathname?.startsWith('/product-tour')

  const isProfilePath = pathname?.startsWith('/dashboard/profile')
  const isPollsPath = pathname?.startsWith('/polls')
  // Elected-official ("serve") flow: a focused, full-screen onboarding
  // experience (/serve/welcome, /serve/onboarding) with its own header/footer
  // chrome, so the global site footer should be suppressed here — the same way
  // the win onboarding flow (/onboarding) is treated as a product route.
  const isServePath = pathname?.startsWith('/serve')
  // Dev-only surfaces (e.g. the /dev/briefings gallery) reuse dashboard chrome
  // and should not show the global site footer.
  const isDevPath = pathname?.startsWith('/dev')

  return Boolean(
    isOnboardingPath ||
    isDashboardPath ||
    isProfilePath ||
    isPollsPath ||
    isServePath ||
    isDevPath,
  )
}
