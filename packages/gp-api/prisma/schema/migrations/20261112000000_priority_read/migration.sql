-- CreateTable
CREATE TABLE "priority_read" (
    "priority_id" TEXT NOT NULL,
    "inputs_key" TEXT NOT NULL,
    "read" JSONB,
    "computed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_read_pkey" PRIMARY KEY ("priority_id")
);

-- CreateIndex
CREATE INDEX "priority_read_computed_at_idx" ON "priority_read"("computed_at");

-- AddForeignKey
ALTER TABLE "priority_read" ADD CONSTRAINT "priority_read_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priority"("id") ON DELETE CASCADE ON UPDATE CASCADE;
