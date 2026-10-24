-- CreateEnum
CREATE TYPE "ChatTurnStatus" AS ENUM ('in_progress', 'completed', 'failed');

-- AlterTable
ALTER TABLE "conversation_messages" ADD COLUMN     "turn_id" UUID;

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "turn_id" UUID;

-- CreateTable
CREATE TABLE "chat_turns" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "status" "ChatTurnStatus" NOT NULL DEFAULT 'in_progress',
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "lock_token" TEXT,
    "locked_until" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error_code" TEXT,
    "error_message" TEXT,
    "result_snapshot" JSONB,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_turns_user_id_created_at_idx" ON "chat_turns"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "chat_turns_status_locked_until_idx" ON "chat_turns"("status", "locked_until");

-- CreateIndex
CREATE INDEX "chat_turns_conversation_id_created_at_idx" ON "chat_turns"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_turns_user_id_idempotency_key_key" ON "chat_turns"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "conversation_messages_turn_id_idx" ON "conversation_messages"("turn_id");

-- CreateIndex
CREATE INDEX "memories_turn_id_idx" ON "memories"("turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "memories_turn_id_content_hash_key" ON "memories"("turn_id", "content_hash");

-- AddForeignKey
ALTER TABLE "memories" ADD CONSTRAINT "memories_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "chat_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "chat_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
