-- AlterEnum
ALTER TYPE "AnnotationResourceType" ADD VALUE 'ordinance';

-- AlterTable
ALTER TABLE "annotation_bug_report" ADD COLUMN     "excerpt" TEXT;
