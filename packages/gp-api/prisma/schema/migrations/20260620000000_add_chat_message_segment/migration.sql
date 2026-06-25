-- CreateEnum
CREATE TYPE "ChatMessageSegmentKind" AS ENUM ('text', 'tool');

-- CreateTable
CREATE TABLE "chat_message_segment" (
    "id" TEXT NOT NULL,
    "chat_message_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" "ChatMessageSegmentKind" NOT NULL,
    "text" TEXT,
    "tool_name" TEXT,

    CONSTRAINT "chat_message_segment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_segment_chat_message_id_ordinal_idx" ON "chat_message_segment"("chat_message_id", "ordinal");

-- AddForeignKey
ALTER TABLE "chat_message_segment" ADD CONSTRAINT "chat_message_segment_chat_message_id_fkey" FOREIGN KEY ("chat_message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
