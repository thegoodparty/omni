# Dev environment: simulated vendors

Dev uses mock vendors. No traffic reaches Peerly, CallHub, Geoapify, Vercel,
Route53, SES, or Scale to Win.

## Auto-progress timings

| Event | Delay |
|---|---|
| CV approval | 2 minutes after submission |
| Use case activation | 5 minutes after CV approves |
| Domain order completion | 30 seconds |
| SMS PIN | Always `123456` |

A domain name starting with `taken-` reports as unavailable.

A Scale to Win contact load finishes as soon as it starts, with every uploaded
row counted as loaded. Tests set other counts or a campaign status through
`VendorMockRecordService.setScaleToWinLoadResult` and
`setScaleToWinCampaignStatus`.

## Starting a test campaign

Campaigns and vendor records created before the cutover (2026-10-21) point at
real vendor IDs the mocks don't know. Those records 404 against the mock.
Start a fresh test campaign after the switch.

## Rolling back to live vendors

Set `VENDOR_MODE=live` on the dev ECS task definition (one-line change in
`packages/gp-api/deploy/index.ts`). This restores real-vendor traffic on dev
with no other code change. Ask in `#engineering` or `#cs-internal` if you
need it done urgently.
