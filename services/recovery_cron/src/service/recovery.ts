import { gcpStore } from "../storage/gcp";
import fs from "node:fs/promises";
import { prisma } from "@sky/db";
import axios from "axios";
import path from "node:path";
import { toRuntimeId } from "@sky/common";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export const recovery = async (databaseProjectId: string) => {
  const pathToVolume = process.env.WORKSPACE_PATH?.trim() || "/user-app/my-app";
  const namespace = process.env.APP_NAMESPACE?.trim() || "default";
  const agentPort = Number(process.env.AGENT_PORT ?? "3000");

  const runtimeId = toRuntimeId(databaseProjectId);
  const restoreReadyPath = path.join(
    path.dirname(pathToVolume),
    ".sky-restore-ready",
  );

  try {
    await Promise.all([
      fs.access(path.join(pathToVolume, "package.json")),
      fs.access(path.join(pathToVolume, ".git")),
    ]);
    await fs.writeFile(restoreReadyPath, "workspace already initialized\n");
    return;
  } catch {
    // A restored snapshot intentionally excludes Git metadata, so recovery is
    // still required when package.json exists but .git does not.
    await fs.unlink(restoreReadyPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const gcpStoreHandler = gcpStore.getInstance();

  // A missing snapshot is a valid new-project state. A corrupt or incomplete
  // snapshot must fail recovery instead of starting from partial files.
  const snapshotFileName = await gcpStoreHandler.retrieveSnapshotData(
    databaseProjectId,
    pathToVolume,
  );

  // The workspace process waits for this marker before scaffolding or starting.
  // This prevents a new Vite project from racing with snapshot extraction.
  await fs.writeFile(
    restoreReadyPath,
    snapshotFileName ? `${snapshotFileName}\n` : "no snapshot available\n",
  );

  let toolCallIdQuery: { id: { gt: number } } | {} = {};

  if (snapshotFileName) {
    const snapshotConversationId = Number(
      path.basename(snapshotFileName, ".zip"),
    );
    if (Number.isFinite(snapshotConversationId)) {
      toolCallIdQuery = { id: { gt: snapshotConversationId } };
    }
  }

  // the above step store the snapshot data in the volume
  // now access the database and get the entries after that last snapshoted id

  // access the database, get the function calls after the timestamp of snapshot
  let toolCallsToPerform = await prisma.conversationHistory.findMany({
    where: {
      ...toolCallIdQuery,
      projectId: databaseProjectId,
      type: "TOOL_CALL",
    },
  });

  const replayUrl = `http://${runtimeId}-agent-service.${namespace}.svc.cluster.local:${Number.isFinite(agentPort) ? agentPort : 3000}/executeFncCalls`;

  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const response = await axios.post(
        replayUrl,
        { toolCalls: toolCallsToPerform },
        { timeout: 3_000 },
      );
      console.log("Recovery replay result:", response.data);
      return;
    } catch (error: any) {
      if (attempt === 30) {
        console.error(
          "Recovery replay failed after waiting for the agent:",
          error.message,
        );
        return;
      }
      await sleep(2_000);
    }
  }
};
