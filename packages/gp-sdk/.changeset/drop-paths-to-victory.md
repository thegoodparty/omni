---
'@goodparty_org/sdk': major
---

Drop the `pathsToVictory` resource and related types (`PathToVictory`, `PathToVictoryData`, `ViabilityScore`, `ListPathsToVictoryOptions`, `UpdatePathToVictoryInput`, `P2VStatus`, `P2VSource`).

The underlying `gp-api` `path_to_victory` table has been removed; race-target metrics are now computed live and exposed through the enriched campaign endpoints. Consumers that previously called `client.pathsToVictory.list/get/update` should read `raceTargetMetrics` off the campaign returned by `client.campaigns.get(id)` instead.
