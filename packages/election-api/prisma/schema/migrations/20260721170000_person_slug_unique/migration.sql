-- The public profile URL is now /people/<slug> (no trailing UUID), so the
-- person slug is the authoritative lookup key and must be unique. The
-- gp-data-platform person mart mints collision-disambiguated slugs; this
-- promotes the former non-unique index to a unique one.

-- DropIndex
DROP INDEX "Person_slug_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Person_slug_key" ON "Person"("slug");
