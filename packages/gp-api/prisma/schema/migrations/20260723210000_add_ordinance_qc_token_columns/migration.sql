-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "qc_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "qc_output_tokens" INTEGER NOT NULL DEFAULT 0;
