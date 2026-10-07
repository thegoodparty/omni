-- The eCanvasser integration mirrored a third-party canvassing tool into our
-- Postgres for the control arm of the native-door-knocking experiment. The
-- flag reached 100%, so nothing reads or writes these tables any more.
--
-- Children are dropped first so no drop meets a live foreign key:
-- ecanvasser_interaction and ecanvasser_contact reference ecanvasser, and
-- ecanvasser_contact also references ecanvasser_house.
DROP TABLE IF EXISTS "ecanvasser_interaction";

DROP TABLE IF EXISTS "ecanvasser_contact";

DROP TABLE IF EXISTS "ecanvasser_house";

DROP TABLE IF EXISTS "ecanvasser";
