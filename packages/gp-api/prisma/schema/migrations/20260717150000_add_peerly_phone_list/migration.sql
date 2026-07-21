-- CreateTable
CREATE TABLE "peerly_phone_list" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "peerly_list_id" INTEGER,
    "voter_file_filter_id" INTEGER,

    CONSTRAINT "peerly_phone_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peerly_phone_list_recipient" (
    "id" TEXT NOT NULL,
    "peerly_phone_list_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "peerly_phone_list_recipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "peerly_phone_list_token_key" ON "peerly_phone_list"("token");

-- CreateIndex
CREATE UNIQUE INDEX "peerly_phone_list_peerly_list_id_key" ON "peerly_phone_list"("peerly_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "peerly_phone_list_recipient_peerly_phone_list_id_person_id_key" ON "peerly_phone_list_recipient"("peerly_phone_list_id", "person_id");

-- AddForeignKey
ALTER TABLE "peerly_phone_list" ADD CONSTRAINT "peerly_phone_list_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peerly_phone_list" ADD CONSTRAINT "peerly_phone_list_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peerly_phone_list_recipient" ADD CONSTRAINT "peerly_phone_list_recipient_peerly_phone_list_id_fkey" FOREIGN KEY ("peerly_phone_list_id") REFERENCES "peerly_phone_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

