-- AlterEnum
ALTER TYPE "ChatScope" ADD VALUE 'background_agent';

-- AlterTable
ALTER TABLE "chat_conversation" ADD COLUMN     "experiment_run_id" TEXT,
ALTER COLUMN "owner_user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "step" JSONB;

-- AlterTable
ALTER TABLE "experiment_run" ADD COLUMN     "shape_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversation_experiment_run_id_key" ON "chat_conversation"("experiment_run_id");

-- AddForeignKey
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_experiment_run_id_fkey" FOREIGN KEY ("experiment_run_id") REFERENCES "experiment_run"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;
