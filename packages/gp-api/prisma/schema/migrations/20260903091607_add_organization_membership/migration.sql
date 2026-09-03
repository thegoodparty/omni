
-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('owner', 'campaignAdmin', 'volunteer');

-- CreateTable
CREATE TABLE "organization_membership" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "invited_by_user_id" INTEGER,

    CONSTRAINT "organization_membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_membership_user_id_idx" ON "organization_membership"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_membership_organization_slug_user_id_key" ON "organization_membership"("organization_slug", "user_id");

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_membership" ADD CONSTRAINT "organization_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

