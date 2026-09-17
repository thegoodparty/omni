import { type Locator, type Page } from '@playwright/test'

/** Person overlay: narrow to the panel that shows Contact Information. */
export function personContactPanel(page: Page): Locator {
  const title = page.getByText('Contact Information', { exact: true })
  return page
    .locator('[data-slot="sheet-content"]')
    .filter({ has: title })
    .or(page.getByRole('dialog').filter({ has: title }))
    .first()
}
