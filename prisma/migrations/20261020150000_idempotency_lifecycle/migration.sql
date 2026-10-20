-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('in_progress', 'completed');

-- AlterTable
ALTER TABLE "idempotency_keys"
    ADD COLUMN "status" "IdempotencyStatus" NOT NULL DEFAULT 'in_progress',
    ADD COLUMN "response_status" INTEGER,
    ADD COLUMN "locked_until" TIMESTAMP(3),
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "response_snapshot" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");
