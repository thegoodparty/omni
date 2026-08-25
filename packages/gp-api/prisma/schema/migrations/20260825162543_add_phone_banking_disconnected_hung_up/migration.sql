-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityConditionAction" ADD VALUE 'disconnected';
ALTER TYPE "ActivityConditionAction" ADD VALUE 'hung_up';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PhoneBankCallOutcome" ADD VALUE 'disconnected';
ALTER TYPE "PhoneBankCallOutcome" ADD VALUE 'hung_up';
