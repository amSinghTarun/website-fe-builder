/*
  Warnings:

  - Added the required column `agentId` to the `ConversationHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `cwd` to the `ConversationHistory` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "MessageFrom" ADD VALUE 'LOOP';

-- AlterTable
ALTER TABLE "ConversationHistory" ADD COLUMN     "agentId" TEXT NOT NULL,
ADD COLUMN     "cwd" TEXT NOT NULL;
