// The Serve SMS rollout flag, shared with gp-webapp's serveSmsFlag.ts. The
// outreach controller gates its write routes on it, and the Chief of Staff
// reads it so it never offers a text the official cannot send.
export const SERVE_SMS_FLAG = 'serve-sms-outreach'
