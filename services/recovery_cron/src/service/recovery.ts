import { gcpStore } from "../storage/gcp";
import fs from "node:fs/promises";
import { prisma } from "@sky/db";
import axios from "axios";

export const recovery = async () => {
  let pathToVolume = "path to volume";
  let projectId = process.env.PROJECT_ID;

  let volumeExist = await fs.exists(pathToVolume);

  if (volumeExist) return;

  let gcpStoreHandler = gcpStore.getInstance();
  let snapshotFileName = await gcpStoreHandler.retrieveSnapshotData(
    "ENV_<PROJECT_ID>",
    pathToVolume,
  );

  let toolCallIdQuery: { id: { gt: number } } | {} = {};

  if (snapshotFileName) {
    toolCallIdQuery = { id: { gt: +snapshotFileName.split(".")[0]! } };
  }

  // the above step store the snapshot data in the volume
  // now access the database and get the entries after that last snapshoted id

  // access the database, get the function calls after the timestamp of snapshot
  let toolCallsToPerform = await prisma.conversationHistory.findMany({
    where: {
      ...toolCallIdQuery,
      projectId: projectId,
      type: "TOOL_CALL",
    },
  });

  try {
    const response = await axios.post(
      `http://${projectId}-agent.default.svc.cluster.local:3001`,
      {
        toolCalls: toolCallsToPerform,
      },
      { timeout: 10000 },
    );
    console.log(response.data);
  } catch (err: any) {
    console.error("Recover request to agent failed:", err.message);
  }
  console.log(toolCallsToPerform);
};
