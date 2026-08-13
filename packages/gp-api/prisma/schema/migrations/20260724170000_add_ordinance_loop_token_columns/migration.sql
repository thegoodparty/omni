-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "loop_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loop_output_tokens" INTEGER NOT NULL DEFAULT 0;
