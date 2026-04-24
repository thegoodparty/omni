---
'@goodparty_org/sdk': minor
---

- Add `client.electedOffices.updateDistrict(id, { state, L2DistrictType, L2DistrictName })` for the M2M `PUT /elected-office/:id/district` endpoint, along with the `UpdateElectedOfficeDistrictInput` and `SetElectedOfficeDistrictOutput` types.
- Add `CampaignWithLiveContext` and `RaceTargetMetrics` types to model the enriched response from `GET /campaigns/:id` (M2M), which now includes `positionName` and live-computed `raceTargetMetrics`.
- `client.campaigns.get(id)` now returns `CampaignWithLiveContext` instead of `ReadCampaignOutput`. This is type-only and additive: `CampaignWithLiveContext extends ReadCampaignOutput`, so existing field access continues to work.
