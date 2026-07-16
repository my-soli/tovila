-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp_number" TEXT NOT NULL,
    "products" JSONB NOT NULL,
    "delivery_info" JSONB NOT NULL,
    "faqs" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellers_whatsapp_number_key" ON "sellers"("whatsapp_number");

-- Backfill: this database already has Phase 1 demo conversations/leads created
-- before sellers existed. Seed the original "Amara Styles" seller here so
-- those existing rows have a valid seller_id to attach to below — the same
-- catalog previously hardcoded in src/agent/seller.js.
INSERT INTO "sellers" ("id", "name", "whatsapp_number", "products", "delivery_info", "faqs")
VALUES (
  gen_random_uuid()::text,
  'Amara Styles',
  '254700000001',
  '[{"name":"Floral Dress","priceKES":2500,"sizes":["S","M","L"],"stock":5},{"name":"Denim Jacket","priceKES":3200,"sizes":["M","L"],"stock":3}]'::jsonb,
  '{"nairobi":{"feeKES":200,"eta":"1-2 days"},"upcountry":{"feeKES":500,"eta":"3-5 days"}}'::jsonb,
  '[{"question":"Do you accept M-Pesa?","answer":"Yes, a Till number is provided at checkout."}]'::jsonb
);

-- AlterTable: link existing conversations to the backfilled seller
ALTER TABLE "conversations" ADD COLUMN "seller_id" TEXT;

UPDATE "conversations"
SET "seller_id" = (SELECT "id" FROM "sellers" WHERE "whatsapp_number" = '254700000001');

ALTER TABLE "conversations" ALTER COLUMN "seller_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "conversations_seller_id_idx" ON "conversations"("seller_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
