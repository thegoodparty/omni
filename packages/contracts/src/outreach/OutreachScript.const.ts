// Peerly rejects P2P job creation when an MMS template's text exceeds this
// ("Template text for MMS is limited to 2000 characters"), so the limit must
// be enforced before payment, not discovered at job-creation time (ENG-10665).
export const P2P_SCRIPT_MAX_LENGTH = 2000
