-- A lead can be sent down both funnels, so the row identity is (user, kind),
-- not user. Under the old single-column unique index the WIN send's upsert
-- matched the SERVE row and overwrote its url, slug, sent_at, expires_at and
-- kind — losing one funnel's record and retiring a short link that had already
-- been texted to the lead.
--
-- Written as a corrective migration rather than an edit to
-- 20260626120000_add_magic_link, matching what 20260813230000 did for the
-- phone index: these files have been applied to dev databases already, and
-- rewriting an applied migration puts prisma into drift.

-- DropIndex
DROP INDEX "magic_link_user_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_user_id_kind_key" ON "magic_link"("user_id", "kind");
