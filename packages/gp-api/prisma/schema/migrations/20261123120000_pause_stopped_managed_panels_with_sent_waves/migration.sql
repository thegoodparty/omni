-- Stop is no longer an action, so a stopped panel that already sent a wave
-- becomes paused: the official keeps the members it built and can resume
-- it, instead of being offered a fresh panel.
-- A panel with a free send still pending stays stopped: the funding gate
-- refuses free sends only for stopped panels, so pausing it would let that
-- text go out for a panel the official asked us to hold.
UPDATE "managed_civic_panel" AS p
SET "status" = 'paused',
    "paused_at" = COALESCE(p."stopped_at", NOW()),
    "stopped_at" = NULL
WHERE p."status" = 'stopped'
  AND EXISTS (
    SELECT 1 FROM "managed_panel_wave" AS w
    WHERE w."enrollment_id" = p."id" AND w."sent_at" IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM "outreach" AS o
    LEFT JOIN "managed_panel_wave" AS ow
      ON ow."id" = o."managed_panel_wave_id"
    WHERE o."status" = 'pending'
      AND o."funded_by" IS NOT NULL
      AND (
        ow."enrollment_id" = p."id"
        OR o."managed_panel_confirmation_for_id" = p."id"
      )
  );
