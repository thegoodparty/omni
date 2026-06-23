-- CreateTable
CREATE TABLE "local_news_cache" (
    "id" TEXT NOT NULL,
    "office" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" BIGINT,
    "outlets" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_news_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_news_cache_office_city_state_key" ON "local_news_cache"("office", "city", "state");
