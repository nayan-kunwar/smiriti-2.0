-- CreateEnum
CREATE TYPE "JobFailureStatus" AS ENUM ('open', 'retried');

-- CreateTable
CREATE TABLE "job_failures" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,
    "error" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" "JobFailureStatus" NOT NULL DEFAULT 'open',
    "retried_at" TIMESTAMP(3),
    "retried_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_failures_status_created_at_idx" ON "job_failures"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_failures_job_name_created_at_idx" ON "job_failures"("job_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "job_failures_job_id_idx" ON "job_failures"("job_id");

-- CreateIndex
CREATE INDEX "job_failures_created_at_idx" ON "job_failures"("created_at");
