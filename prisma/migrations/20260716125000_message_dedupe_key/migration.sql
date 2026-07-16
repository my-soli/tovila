-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "source_message_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_source_message_id_key" ON "messages"("source_message_id");
