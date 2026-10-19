-- OfficeHolder is a dependent child of Person (required person_id, meaningless
-- without one). The initial FK used Prisma's default RESTRICT for a required
-- relation, which would hard-fail whenever ETL deletes or re-mints a Person that
-- has OfficeHolder rows. Switch to CASCADE so office rows are removed atomically
-- with their Person, matching the parent/child semantics (Candidacy stays
-- SET NULL because it is independent and nullable).
ALTER TABLE "OfficeHolder" DROP CONSTRAINT "OfficeHolder_person_id_fkey";
ALTER TABLE "OfficeHolder" ADD CONSTRAINT "OfficeHolder_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
