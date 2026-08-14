/*
  Warnings:

  - The values [first_time] on the enum `VoterLikelihood` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "VoterLikelihood_new" AS ENUM ('unknown', 'unlikely', 'unreliable', 'likely', 'super');
ALTER TYPE "VoterLikelihood" RENAME TO "VoterLikelihood_old";
ALTER TYPE "VoterLikelihood_new" RENAME TO "VoterLikelihood";
DROP TYPE "public"."VoterLikelihood_old";
COMMIT;
