// Safety bound for the phone-list build-status poll (SmsFlow's LongPoll): a
// build that genuinely never resolves -- the build row cleaned up, a routing
// problem, or any other permanent non-2xx that getP2pPhoneListBuildStatus
// reads as `building` -- must not spin forever. ~900 attempts at LongPoll's
// ~1s interval is a generous ~15-minute ceiling, far longer than any build
// that is actually still in progress; past it the build is presumed stuck
// and the poll surfaces as a failure. A separate module so a test can stub
// it to a small value rather than waiting out the real ceiling.
export const PHONE_LIST_BUILD_POLL_LIMIT = 900
