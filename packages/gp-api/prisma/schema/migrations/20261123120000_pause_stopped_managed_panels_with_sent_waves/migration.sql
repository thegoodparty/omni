-- Stop is no longer an action, so a stopped panel that already sent a wave
-- becomes paused: the official keeps the members it built and can resume
-- it, instead of being offered a fresh panel.
UPDATE "managed_civic_panel" AS p
SET "status" = 'paused',
    "paused_at" = COALESCE(p."stopped_at", NOW()),
    "stopped_at" = NULL
WHERE p."status" = 'stopped'
  AND EXISTS (
    SELECT 1 FROM "managed_panel_wave" AS w
    WHERE w."enrollment_id" = p."id" AND w."sent_at" IS NOT NULL
  );
