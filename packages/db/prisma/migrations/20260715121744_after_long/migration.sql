/*
  Warnings:

  - The values [WRITE_FILE] on the enum `ToolCall` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ToolCall_new" AS ENUM ('READ_DIR', 'READ_FILE', 'CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE', 'CREATE_SUB_AGENT', 'INFORM_TASK_COMPLETION', 'WAITING_FOR_SUB_AGENT', 'CREATE_PLAN', 'TAKE_INPUT');
ALTER TABLE "ConversationHistory" ALTER COLUMN "toolCall" TYPE "ToolCall_new" USING ("toolCall"::text::"ToolCall_new");
ALTER TYPE "ToolCall" RENAME TO "ToolCall_old";
ALTER TYPE "ToolCall_new" RENAME TO "ToolCall";
DROP TYPE "public"."ToolCall_old";
COMMIT;

-- AlterTable
ALTER TABLE "ConversationHistory" ADD COLUMN     "output" TEXT,
ALTER COLUMN "toolCall" DROP NOT NULL,
ALTER COLUMN "completed" DROP NOT NULL,
ALTER COLUMN "snapshotCaptured" DROP NOT NULL;
