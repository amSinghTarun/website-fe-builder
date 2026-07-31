/*
  Warnings:

  - Added the required column `library` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "ToolCall" ADD VALUE 'GET_CURRENT_WORKSPACE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "library" TEXT NOT NULL;
