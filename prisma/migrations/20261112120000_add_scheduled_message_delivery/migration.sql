ALTER TABLE "School"
ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos';

DO $$
BEGIN
  CREATE TYPE "MessageChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

CREATE TABLE IF NOT EXISTS "MessageDelivery" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "userId" TEXT,
  "channel" "MessageChannel" NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "dedupeKey" TEXT,
  "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MessageDelivery_schoolId_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "School"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "MessageDelivery"
ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageDelivery_channel_dedupeKey_key"
ON "MessageDelivery"("channel", "dedupeKey");

CREATE INDEX IF NOT EXISTS "MessageDelivery_status_nextAttemptAt_idx"
ON "MessageDelivery"("status", "nextAttemptAt");

CREATE INDEX IF NOT EXISTS "MessageDelivery_status_claimedAt_idx"
ON "MessageDelivery"("status", "claimedAt");

CREATE INDEX IF NOT EXISTS "MessageDelivery_schoolId_idx"
ON "MessageDelivery"("schoolId");
