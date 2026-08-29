-- CreateEnum
CREATE TYPE "ConversationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED');

-- AlterTable
ALTER TABLE "ConversationHistory"
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "status" "ConversationRunStatus";

-- Preserve the meaning of existing user-message rows. Historical failures
-- cannot be distinguished because they were previously stored in output.
UPDATE "ConversationHistory"
SET "status" = CASE
  WHEN "completed" IS TRUE THEN 'SUCCEEDED'::"ConversationRunStatus"
  WHEN "completed" IS FALSE THEN 'RUNNING'::"ConversationRunStatus"
  ELSE NULL
END
WHERE "type" = 'TEXT_MESSAGE' AND "from" = 'USER';
