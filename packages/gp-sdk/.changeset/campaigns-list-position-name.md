---
'@goodparty_org/sdk': minor
---

- Add `CampaignWithPositionName` type, modeling the enriched per-item response from `GET /campaigns/list` (M2M), which now includes `positionName` resolved from each campaign's organization.
- `client.campaigns.list()` now returns `PaginatedList<CampaignWithPositionName>` instead of `PaginatedList<ReadCampaignOutput>`. This is type-only and additive: `CampaignWithPositionName extends ReadCampaignOutput`, so existing field access continues to work.
- Live race-target metrics are intentionally omitted from list responses to keep them cheap; use `client.campaigns.get(id)` to fetch `raceTargetMetrics` for a single campaign.
