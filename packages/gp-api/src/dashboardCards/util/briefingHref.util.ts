// Reproduces the two gp-webapp briefing URL formats
// (app/shared/briefings/routes.ts) server-side. These are stable strings;
// we deliberately don't import across the package boundary.

export const briefingOverviewHref = (date: string): string =>
  `/dashboard/briefings/${date}`

export const briefingItemHref = (date: string, itemId: string): string =>
  `${briefingOverviewHref(date)}#briefing-item-${itemId}`
