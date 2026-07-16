-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "status" SET DEFAULT 'pending';

-- Migrate existing leads created under the old default status value.
UPDATE "leads" SET "status" = 'pending' WHERE "status" = 'new';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "media_id" TEXT,
ADD COLUMN     "media_type" TEXT;

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "mpesa_till_number" TEXT,
ADD COLUMN     "seller_notification_email" TEXT;

-- Backfill demo sellers with example values so the environment stays
-- demo-ready without requiring a reseed.
UPDATE "sellers" SET
  "mpesa_till_number" = '174379',
  "seller_notification_email" = 'owner@amarastyles.example'
WHERE "whatsapp_number" = '254700000001';

UPDATE "sellers" SET
  "mpesa_till_number" = '445566',
  "seller_notification_email" = 'owner@kikojewellery.example'
WHERE "whatsapp_number" = '254700000002';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_seller_id_idx" ON "notifications"("seller_id");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
