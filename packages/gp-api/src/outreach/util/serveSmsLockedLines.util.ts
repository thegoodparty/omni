import { BadRequestException } from '@nestjs/common'
import {
  checkSmsStandards,
  countCivicPanelLines,
  findCivicPanelJoinLine,
  findCivicPanelLeaveLine,
} from '@goodparty_org/contracts'

// The lines the composer locks, checked again on the way in, so a composer
// bug can never reach a send: honoring STOP follows the message, and a
// second JOIN or LEAVE line texts people the same ask twice.
export const assertServeSmsLockedLines = (message: string): void => {
  if (checkSmsStandards(message).failures.includes('opt_out_line')) {
    throw new BadRequestException(
      'Your text is missing its opt-out line. Add "Reply STOP to opt out." as the last line and try again.',
    )
  }
  // A JOIN beside a LEAVE is its own refusal, further down.
  const both =
    findCivicPanelJoinLine(message) !== null &&
    findCivicPanelLeaveLine(message) !== null
  if (countCivicPanelLines(message) > (both ? 2 : 1)) {
    throw new BadRequestException(
      'Your text has its civic panel line more than once. Keep one and try again.',
    )
  }
}
