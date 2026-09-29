// Peerly rejects P2P job creation when an MMS template's text exceeds this
// ("Template text for MMS is limited to 2000 characters"), so the limit must
// be enforced before payment, not discovered at job-creation time (ENG-10665).
export const P2P_SCRIPT_MAX_LENGTH = 2000

// The recorded robocall's script cap. It lives here rather than beside the
// robocall schemas because `RobocallPurchase.schema.ts` needs it and
// `RobocallScript.schema.ts` reads `SocialToneSchema` off
// `OutreachSocial.schema.ts`, which in turn reads the robocall detail off
// `RobocallPurchase.schema.ts` — importing the cap from the schema module
// closes that ring, and a bundled cycle leaves `SocialToneSchema` undefined
// at module-init time (every robocall draft request then fails validation).
export const ROBOCALL_SCRIPT_MAX_LENGTH = 2000
