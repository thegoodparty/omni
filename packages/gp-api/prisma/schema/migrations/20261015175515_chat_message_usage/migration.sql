-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "model" TEXT,
ADD COLUMN     "input_tokens" INTEGER,
ADD COLUMN     "output_tokens" INTEGER;
