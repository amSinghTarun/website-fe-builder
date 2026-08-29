import { gcpStore } from "../storage/gcp";
import { Cron } from "croner";
import { prisma } from "@sky/db";
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";

export async function createWorkspaceArchive(
  workspacePath: string,
): Promise<Buffer> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];

  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.glob("**/*", {
    cwd: workspacePath,
    dot: true,
    ignore: ["node_modules/**", ".git/**"],
  });
  await archive.finalize();
  return completed;
}

export const backupCron = (databaseProjectId: string) => {
  new Cron(
    " 20 * * * * * ",
    {
      protect: (job) => {
        // if this wouldn't have been delivered by croner out of the box, so had to do it manually with something like `if (isProcessing) {continue} else {process messages} `;
        console.log("Last batch still going on \n", job);
      },
      catch: (error) => {
        console.log("Error in cron \n", error);
      },
    },
    async () => {
      const volumePath =
        process.env.WORKSPACE_PATH?.trim() || "/user-app/my-app";

      console.log("Cron job to upload backup started");
      let gcpStoreHandler = gcpStore.getInstance();

      // get the last done functionCall from the database and use it's updated time as timestamp on the file
      let lastDoneToolCall = await prisma.conversationHistory.findFirst({
        where: {
          projectId: databaseProjectId,
          from: "USER",
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          updatedAt: true,
          status: true,
          completed: true,
          toolCall: true,
          snapshotCaptured: true,
        },
      });

      if (
        !lastDoneToolCall ||
        (lastDoneToolCall.status
          ? lastDoneToolCall.status !== "SUCCEEDED"
          : lastDoneToolCall.completed !== true) ||
        lastDoneToolCall.snapshotCaptured
      ) {
        return;
      }

      const uploadData = await createWorkspaceArchive(volumePath);

      // Record the latest history row included in this snapshot. Tool calls
      // belonging to the completed user turn have IDs after its TEXT_MESSAGE
      // row, so using the user row ID would replay already-snapshotted writes.
      const snapshotHighWaterMark = await prisma.conversationHistory.findFirst({
        where: { projectId: databaseProjectId },
        orderBy: { id: "desc" },
        select: { id: true },
      });

      if (!snapshotHighWaterMark) return;

      // if (
      //   (lastDoneToolCall.toolCall == PrismaEnums.ToolCall.DELETE_FILE ||
      //     lastDoneToolCall.toolCall == PrismaEnums.ToolCall.CREATE_FILE ||
      //     lastDoneToolCall.toolCall == PrismaEnums.ToolCall.UPDATE_FILE) &&
      //   !lastDoneToolCall.snapshotCaptured
      // ) {
      await gcpStoreHandler.putDataInBucket(
        uploadData,
        `${databaseProjectId}/${snapshotHighWaterMark.id}.zip`,
      );

      await prisma.conversationHistory.update({
        where: {
          id: lastDoneToolCall.id,
        },
        data: {
          snapshotCaptured: true,
        },
      });
      // }
      return;
    },
  );
};
