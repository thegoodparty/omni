-- Path C: the row the canary Lambda updates once a minute (README step C3).
-- Mirrored like any other table, so a missing canary means the whole path is
-- stalled. Safe to re-run.

CREATE TABLE IF NOT EXISTS replication_canary (
  id integer PRIMARY KEY,
  written_at timestamptz NOT NULL DEFAULT now()
);
