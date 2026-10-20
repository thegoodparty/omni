-- The read source for path B (POC_ORG_LAYER_LOG_SOURCE). Lakeflow Connect lands
-- PostgreSQL uuid as BINARY (postgresql-reference, "Automatic data
-- transformations"); the person view and the freshness benchmark compare
-- event_id with uuid text. This turns 16 raw bytes back into canonical uuid
-- text and passes text through, so it works whichever form actually lands.
-- Run once, after the first ingestion run creates the mirror table (README 5.6).
CREATE OR REPLACE VIEW goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event_log AS
SELECT
  CASE
    WHEN octet_length(event_id) = 16 THEN lower(concat_ws('-',
      substr(hex(event_id), 1, 8),
      substr(hex(event_id), 9, 4),
      substr(hex(event_id), 13, 4),
      substr(hex(event_id), 17, 4),
      substr(hex(event_id), 21, 12)))
    ELSE lower(CAST(event_id AS STRING))
  END AS event_id,
  org_slug,
  person_id,
  kind,
  field,
  value,
  source,
  import_id,
  actor_user_id,
  created_at
FROM goodparty_data_catalog.poc_import_contacts_lakeflow.org_contact_event
