---
"@goodparty_org/sdk": minor
---

Replace all locally-defined types with imports from @goodparty_org/contracts.

- Delete `types/campaign.ts` and `types/user.ts` — all types now come from contracts
- Delete local `PaginationOptions` from `types/result.ts` — uses contracts' `PaginationOptions`
- Replace `Campaign` with `ReadCampaignOutput`, `ListCampaignsOptions` with `ListCampaignsPagination`, `UpdateCampaignInput` with `UpdateCampaignM2MInput` from contracts
- Replace `ListUsersOptions` with `ListUsersPagination`, `UpdateUserInput` with contracts' `UpdateUserInput`
- Add `src/enums.ts` with runtime enum-like objects (UserRole, CampaignTier, etc.) derived from contracts const arrays via declaration merging, preserving backward-compatible `EnumName.value` access for consumers
- Export all const value arrays (USER_ROLE_VALUES, CAMPAIGN_TIER_VALUES, etc.) from contracts
- Update `electedOffice.ts` and `pathToVictory.ts` to import `PaginationOptions` from contracts
