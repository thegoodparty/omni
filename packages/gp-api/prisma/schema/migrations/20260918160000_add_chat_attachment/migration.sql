-- CreateEnum
CREATE TYPE "ChatAttachmentSource" AS ENUM ('UPLOAD', 'URL');

-- CreateEnum
CREATE TYPE "ChatAttachmentStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "chat_attachment" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "owner_user_id" INTEGER NOT NULL,
    "source" "ChatAttachmentSource" NOT NULL,
    "source_url" TEXT,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER,
    "status" "ChatAttachmentStatus" NOT NULL DEFAULT 'pending',
    "extracted_text" TEXT,
    "failure_reason" TEXT,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_attachment_conversation_id_status_idx" ON "chat_attachment"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "chat_attachment_owner_user_id_idx" ON "chat_attachment"("owner_user_id");

-- AddForeignKey
ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachment" ADD CONSTRAINT "chat_attachment_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
