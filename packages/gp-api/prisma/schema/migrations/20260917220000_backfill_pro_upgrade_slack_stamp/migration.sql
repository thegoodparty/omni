-- Restores the `proUpgradeSlackNotifiedAt` stamp on the two prod campaigns
-- whose Pro-upgrade announcement was posted to Slack but never recorded.
--
-- notifySlackOnProUpgrade posts the message and only then calls
-- patchCampaignDetails to stamp it, and it wraps the whole thing in a catch
-- that logs. Before #1942 that patch was a read-modify-write whose read
-- happened outside its Serializable transaction, so a concurrent patch of the
-- same row could abort it with P2034. When that happened the stamp was lost
-- AFTER the message had gone out, and the campaign was left eligible to be
-- announced a second time the next time it crossed non-Pro -> Pro (a
-- cancellation followed by a resubscribe; setIsPro fires the notify only on
-- that transition).
--
-- Both rows, from Loki (service_name="gp-api",
-- deployment_environment_name="prod"), each a POST /v1/payments/events
-- handling checkout.session.completed:
--
--   222443  2026-08-28T16:34:28.076Z  requestId a0447c80-4dc1-44ba-9f93-f835ed089f0a
--   326572  2026-09-02T01:38:16.075Z  requestId c464cdee-b833-46f6-adc8-272159205322
--
-- Both error lines carry code P2034 and a stack whose innermost frames are
-- `CampaignsService.patchCampaignDetails` called from
-- `CampaignTasksService.notifySlackOnProUpgrade` — the stamp write, which is
-- the only patchCampaignDetails call in that method and is reached only after
-- the Slack send has returned. sendSlackWithRetry throws on a failed send, so
-- reaching the stamp at all means the message was posted; prod logged zero
-- "Slack send failed, retrying" lines in the 30 days to 2026-09-17, so neither
-- send was even a retry. For 222443 the conflicting writer is visible too:
-- customer.subscription.created (requestId d7f1d784-20ab-4641-8d76-6817800408df)
-- arrived 223ms ahead of the checkout event and patched details.subscriptionId
-- on the same blob.
--
-- The values below are those log timestamps. The stamp the code would have
-- written is a Date.now() taken a few hundred milliseconds earlier in the same
-- request, and the log line is the closest surviving observation of it; the
-- upgrade time was rejected as a substitute because it is a different quantity
-- and is already recorded separately as details.isProUpdatedAt.
-- `proUpgradeSlackNotifiedAtBackfilledAt` exists so nobody later mistakes a
-- reconstructed stamp for one that was recorded live: only this migration
-- writes it, the API allowlist in updateCampaign.schema.ts does not accept it,
-- and its presence means the sibling timestamp came from a log line rather
-- than from the code path.
--
-- Deliberately only these two ids. 47 other prod campaigns took the same
-- upgrade path in that window and are correctly unstamped — they logged "Pro
-- upgrade with no tracker or default tasks; Slack notification skipped", which
-- returns before stamping precisely so a later trigger can still announce
-- them. A sweep over every campaign missing the key would stamp those 47 and
-- silence an announcement they are still owed.
--
-- Data-only: no schema change, so `prisma migrate diff` stays clean.
UPDATE campaign
SET details = campaign.details
        || jsonb_build_object(
            'proUpgradeSlackNotifiedAt', repair.notified_at_ms,
            'proUpgradeSlackNotifiedAtBackfilledAt',
            to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ),
    updated_at = NOW()
FROM (
    VALUES
        (222443, 1787934868076::bigint),
        (326572, 1788313096075::bigint)
) AS repair (campaign_id, notified_at_ms)
WHERE campaign.id = repair.campaign_id
  -- The bug drops the key, so key-absent is the signature being repaired. A
  -- row that already carries a stamp has been announced and recorded by some
  -- path since, and overwriting it would move a real record onto a
  -- reconstructed one. Same guard as patchCampaignDetails for the details
  -- column itself: `||` against a non-object would raise.
  AND jsonb_typeof(campaign.details) = 'object'
  AND campaign.details -> 'proUpgradeSlackNotifiedAt' IS NULL;
