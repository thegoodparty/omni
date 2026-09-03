-- AlterTable
ALTER TABLE "contact_interaction_door_knock" ADD COLUMN     "actor_user_id" INTEGER;

-- CreateIndex
CREATE INDEX "contact_interaction_door_knock_organization_slug_actor_user_idx" ON "contact_interaction_door_knock"("organization_slug", "actor_user_id");

-- AddForeignKey
ALTER TABLE "contact_interaction_door_knock" ADD CONSTRAINT "contact_interaction_door_knock_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

