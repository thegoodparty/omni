-- CreateTable
CREATE TABLE "db_change_gap" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "db_change_gap_pkey" PRIMARY KEY ("id")
);

-- The kill switch flipping is a gap in capture that leaves nothing else behind:
-- trigger writes stop, so the outbox stays empty and every downstream signal is
-- silent. Recorded here so a handler's missing writes can be explained later.
CREATE OR REPLACE FUNCTION db_change_config_flip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.enabled IS NOT DISTINCT FROM OLD.enabled THEN
    RETURN NULL;
  END IF;

  INSERT INTO db_change_gap (kind, detail)
  VALUES (
    'config',
    jsonb_build_object('enabled', NEW.enabled, 'previous', OLD.enabled)
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER "db_change_config_flip" AFTER UPDATE ON "db_change_config"
  FOR EACH ROW EXECUTE FUNCTION db_change_config_flip();
