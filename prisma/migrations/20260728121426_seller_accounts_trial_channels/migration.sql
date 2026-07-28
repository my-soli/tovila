-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp';

-- AlterTable
ALTER TABLE "sellers" ADD COLUMN     "email" TEXT,
ADD COLUMN     "email_verification_expires" TIMESTAMP(3),
ADD COLUMN     "email_verification_token" TEXT,
ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "instagram_access_token" TEXT,
ADD COLUMN     "instagram_account_id" TEXT,
ADD COLUMN     "password_hash" TEXT,
ADD COLUMN     "tiktok_access_token" TEXT,
ADD COLUMN     "tiktok_account_id" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "trial_started_at" TIMESTAMP(3),
ALTER COLUMN "whatsapp_number" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "conversations_channel_idx" ON "conversations"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_key" ON "sellers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_email_verification_token_key" ON "sellers"("email_verification_token");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_instagram_account_id_key" ON "sellers"("instagram_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sellers_tiktok_account_id_key" ON "sellers"("tiktok_account_id");
