-- AlterTable
ALTER TABLE "contact_interaction_phone_banking" ADD COLUMN     "actor_user_id" INTEGER;

-- AlterTable
ALTER TABLE "contact_note" ADD COLUMN     "actor_user_id" INTEGER;

-- AddForeignKey
ALTER TABLE "contact_interaction_phone_banking" ADD CONSTRAINT "contact_interaction_phone_banking_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_note" ADD CONSTRAINT "contact_note_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
