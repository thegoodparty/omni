-- CreateEnum
CREATE TYPE "ChatFeedbackKind" AS ENUM ('positive', 'negative');

-- CreateTable
CREATE TABLE "chat_message_feedback" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "chat_message_id" TEXT NOT NULL,
    "submitter_user_id" INTEGER NOT NULL,
    "feedback" "ChatFeedbackKind" NOT NULL,
    "comment" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_feedback_user_message_unique" ON "chat_message_feedback"("submitter_user_id", "chat_message_id");

-- CreateIndex
CREATE INDEX "chat_message_feedback_conversation_id_idx" ON "chat_message_feedback"("conversation_id");

-- AddForeignKey
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_submitter_user_id_fkey" FOREIGN KEY ("submitter_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
