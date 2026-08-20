-- CreateEnum
CREATE TYPE "SocialAssetPlatform" AS ENUM ('facebook', 'instagram', 'nextdoor', 'x', 'tiktok', 'youtube_shorts');

-- CreateEnum
CREATE TYPE "SocialAssetKind" AS ENUM ('post_copy', 'video_script');

-- CreateTable
CREATE TABLE "outreach_social" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "draft_message" TEXT NOT NULL,

    CONSTRAINT "outreach_social_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_social_asset" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outreach_social_id" INTEGER NOT NULL,
    "platform" "SocialAssetPlatform" NOT NULL,
    "kind" "SocialAssetKind" NOT NULL,
    "text" TEXT NOT NULL,
    "caption" TEXT,

    CONSTRAINT "outreach_social_asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outreach_social_outreach_id_key" ON "outreach_social"("outreach_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_social_asset_outreach_social_id_platform_key" ON "outreach_social_asset"("outreach_social_id", "platform");

-- AddForeignKey
ALTER TABLE "outreach_social" ADD CONSTRAINT "outreach_social_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_social_asset" ADD CONSTRAINT "outreach_social_asset_outreach_social_id_fkey" FOREIGN KEY ("outreach_social_id") REFERENCES "outreach_social"("id") ON DELETE CASCADE ON UPDATE CASCADE;
