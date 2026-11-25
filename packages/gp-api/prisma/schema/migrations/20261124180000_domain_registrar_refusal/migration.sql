-- AlterTable
ALTER TABLE "domain" ADD COLUMN     "registrar_refusal_code" TEXT,
ADD COLUMN     "registrar_refused_at" TIMESTAMP(3);
