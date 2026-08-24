import { ConflictException } from '@nestjs/common'

// 409 rather than the 422 an invalid PIN returns: no PIN exists yet, so the
// value the candidate typed can't be judged wrong. The distinct status is what
// lets the FE say "verification is still in progress" instead of blaming the
// candidate's input (ENG-10866).
export class CampaignVerifyPinNotIssuedException extends ConflictException {
  constructor() {
    super(
      "CampaignVerify hasn't issued your PIN yet. We'll email you as soon " +
        'as it has been sent.',
    )
  }
}
