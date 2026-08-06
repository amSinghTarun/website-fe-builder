/*
  Warnings:

  - The `toolCall` column on the `ConversationHistory` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "ConversationHistory" DROP COLUMN "toolCall",
ADD COLUMN     "toolCall" TEXT;

-- DropEnum
DROP TYPE "ToolCall";
