import { gcpStore } from "../storage/gcp";
import { Cron } from "croner";
import { prisma, $Enums as PrismaEnums } from "@sky/db";

export const backupCron = () => {
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
      let projectId = "ENV<PROJECT_ID>";

      console.log("Cron job to upload backup started");
      let gcpStoreHandler = gcpStore.getInstance();

      //data from the volume, exclude node_modules
      let volumePath = "/app";

      // access the database before reading the directory
      let uploadData = Bun.gzipSync(volumePath);

      // get the last done functionCall from the database and use it's updated time as timestamp on the file
      let lastDoneToolCall = await prisma.conversationHistory.findFirst({
        where: {
          projectId: projectId,
          from: "USER",
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          updatedAt: true,
          completed: true,
          toolCall: true,
          snapshotCaptured: true,
        },
      });

      if (!lastDoneToolCall || !lastDoneToolCall.completed) return;

      // if (
      //   (lastDoneToolCall.toolCall == PrismaEnums.ToolCall.DELETE_FILE ||
      //     lastDoneToolCall.toolCall == PrismaEnums.ToolCall.CREATE_FILE ||
      //     lastDoneToolCall.toolCall == PrismaEnums.ToolCall.UPDATE_FILE) &&
      //   !lastDoneToolCall.snapshotCaptured
      // ) {
      await gcpStoreHandler.putDataInBucket(
        uploadData,
        `${projectId}/${lastDoneToolCall.id}.zip`,
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
