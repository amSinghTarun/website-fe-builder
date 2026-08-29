-- Preserve the untouched model completion separately from the polished UI reply.
ALTER TABLE "ConversationHistory"
ADD COLUMN "rawOutput" TEXT;

-- Store one durable context checkpoint per project. ConversationHistory rows
-- after the high-water mark remain available as recent, unsummarised turns.
CREATE TABLE "AgentMemory" (
    "projectId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "summarizedThroughHistoryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("projectId")
);

ALTER TABLE "AgentMemory"
ADD CONSTRAINT "AgentMemory_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ConversationHistory_projectId_type_agentId_id_idx"
ON "ConversationHistory"("projectId", "type", "agentId", "id");
