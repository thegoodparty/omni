-- POC import contacts change log, Postgres side. Same columns as the Delta log
-- goodparty_data_catalog.poc_import_contacts.org_contact_event. Applied by hand
-- with psql against the POC cluster's poc_org_layer database (README step 3).

CREATE TABLE IF NOT EXISTS org_contact_event (
  event_id uuid PRIMARY KEY,
  org_slug text NOT NULL,
  person_id text NOT NULL,
  kind text NOT NULL,
  field text,
  value text,
  source text NOT NULL,
  import_id text,
  actor_user_id integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_contact_event_org_person_idx
  ON org_contact_event (org_slug, person_id);
