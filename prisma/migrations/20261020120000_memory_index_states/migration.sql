-- CreateTable
CREATE TABLE "memory_index_states" (
    "memory_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" "EmbeddingStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memory_index_states_pkey" PRIMARY KEY ("memory_id")
);

-- CreateIndex
CREATE INDEX "memory_index_states_status_idx" ON "memory_index_states"("status");

-- AddForeignKey
ALTER TABLE "memory_index_states" ADD CONSTRAINT "memory_index_states_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill state for memories that were already embedded before this migration.
INSERT INTO "memory_index_states" ("memory_id", "content_hash", "status", "updated_at")
SELECT
    e."memory_id",
    m."content_hash",
    CASE
        WHEN bool_or(e."status" = 'failed') THEN 'failed'::"EmbeddingStatus"
        WHEN bool_and(e."status" = 'indexed') THEN 'indexed'::"EmbeddingStatus"
        ELSE 'pending'::"EmbeddingStatus"
    END,
    CURRENT_TIMESTAMP
FROM "memory_embeddings" e
JOIN "memories" m ON m."id" = e."memory_id"
GROUP BY e."memory_id", m."content_hash"
ON CONFLICT ("memory_id") DO NOTHING;
