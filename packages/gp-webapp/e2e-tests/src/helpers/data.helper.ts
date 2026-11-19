import { generateTestUserData as generate } from '@goodparty_org/test-users'

// Kept as a class because spec helpers call it that way; the data it generates
// comes from @goodparty_org/test-users, so the judge's users are shaped exactly
// like the suite's.
export class TestDataHelper {
  /**
   * Generate test user data (does NOT create actual user)
   * Use this for form validation tests that don't submit
   */
  static generateTestUserData = generate

  /**
   * Generate timestamp string
   */
  static generateTimestamp(): string {
    const now = new Date()
    const month = `${now.getMonth() + 1}`.padStart(2, '0')
    const day = `${now.getDate()}`.padStart(2, '0')
    const hours = `${now.getHours()}`.padStart(2, '0')
    const minutes = `${now.getMinutes()}`.padStart(2, '0')
    const seconds = `${now.getSeconds()}`.padStart(2, '0')
    return `${month}${day}${hours}${minutes}${seconds}`
  }
}
