-- AlterEnum
-- Serve calls and doors can invite residents to the civic panel, under the
-- same slug as the Serve text's invite.
ALTER TYPE "PhoneBankingPurpose" ADD VALUE 'build_citizens_panel';

-- AlterEnum
ALTER TYPE "DoorKnockingPurpose" ADD VALUE 'build_citizens_panel';
