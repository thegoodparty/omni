-- Path A schema drill, part 2: what `prisma migrate` generates for a renamed
-- field (@map change) and a changed column type. Guarded so it can be re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'poc_federation_drill'
      AND column_name = 'label'
  ) THEN
    ALTER TABLE "poc_federation_drill" RENAME COLUMN "label" TO "title";
  END IF;
END $$;

ALTER TABLE "poc_federation_drill"
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
