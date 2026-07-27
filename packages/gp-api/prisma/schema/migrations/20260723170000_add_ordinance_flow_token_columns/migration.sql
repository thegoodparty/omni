-- AlterTable
ALTER TABLE "ordinance" ADD COLUMN     "flow_input_tokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flow_output_tokens" INTEGER NOT NULL DEFAULT 0;
