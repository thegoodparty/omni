-- AlterTable
ALTER TABLE "magic_link" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_slug_key" ON "magic_link"("slug");
