-- CreateTable
CREATE TABLE "outreach_assignment" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_slug" TEXT NOT NULL,
    "outreach_id" INTEGER NOT NULL,
    "assignee_user_id" INTEGER NOT NULL,
    "assigned_by_user_id" INTEGER,

    CONSTRAINT "outreach_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_assignment_assignee_user_id_idx" ON "outreach_assignment"("assignee_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_assignment_outreach_id_assignee_user_id_key" ON "outreach_assignment"("outreach_id", "assignee_user_id");

-- AddForeignKey
ALTER TABLE "outreach_assignment" ADD CONSTRAINT "outreach_assignment_organization_slug_fkey" FOREIGN KEY ("organization_slug") REFERENCES "organization"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_assignment" ADD CONSTRAINT "outreach_assignment_outreach_id_fkey" FOREIGN KEY ("outreach_id") REFERENCES "outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_assignment" ADD CONSTRAINT "outreach_assignment_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_assignment" ADD CONSTRAINT "outreach_assignment_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

