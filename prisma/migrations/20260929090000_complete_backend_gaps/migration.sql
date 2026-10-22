-- Complete backend gaps: Paystack subscription payments

CREATE TABLE "SubscriptionPayment" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPayment_reference_key"
ON "SubscriptionPayment"("reference");

CREATE INDEX "SubscriptionPayment_schoolId_idx"
ON "SubscriptionPayment"("schoolId");

CREATE INDEX "SubscriptionPayment_subscriptionId_idx"
ON "SubscriptionPayment"("subscriptionId");

CREATE INDEX "SubscriptionPayment_status_idx"
ON "SubscriptionPayment"("status");

CREATE INDEX "SubscriptionPayment_createdAt_idx"
ON "SubscriptionPayment"("createdAt");

ALTER TABLE "SubscriptionPayment"
ADD CONSTRAINT "SubscriptionPayment_schoolId_fkey"
FOREIGN KEY ("schoolId")
REFERENCES "School"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPayment"
ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId")
REFERENCES "Subscription"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;