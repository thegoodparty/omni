-- AlterTable
ALTER TABLE "voter_file_filter" ADD COLUMN     "contacts_made_0" BOOLEAN DEFAULT false,
ADD COLUMN     "contacts_made_1" BOOLEAN DEFAULT false,
ADD COLUMN     "contacts_made_2" BOOLEAN DEFAULT false,
ADD COLUMN     "contacts_made_3" BOOLEAN DEFAULT false,
ADD COLUMN     "contacts_made_4" BOOLEAN DEFAULT false,
ADD COLUMN     "contacts_made_5_plus" BOOLEAN DEFAULT false;
