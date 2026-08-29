export type PersistedChatRecord = {
  id: number;
  contents: string;
  from: "USER" | "ASSISTANT" | "LOOP";
  output: string | null;
  errorMessage: string | null;
  status:
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED"
    | "BLOCKED"
    | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  from: "user" | "assistant" | "status";
  message: string;
  tone?: "error" | "warning" | "muted";
};

export function mapChatHistory(
  records: PersistedChatRecord[],
): ChatMessage[] {
  return [...records]
    .sort((first, second) => {
      const timestampDifference =
        new Date(first.createdAt).getTime() -
        new Date(second.createdAt).getTime();
      return timestampDifference || first.id - second.id;
    })
    .flatMap((record) => {
      const messages: ChatMessage[] = [];
      const contents = record.contents.trim();
      const output = record.output?.trim();
      const errorMessage = record.errorMessage?.trim();

      if (contents) {
        messages.push({
          id: String(record.id),
          from: record.from === "USER" ? "user" : "assistant",
          message: contents,
        });
      }

      // The agent stores its final response alongside the originating user
      // message. Recreate the two chat bubbles when a project is resumed.
      if (record.from === "USER" && output) {
        messages.push({
          id: `${record.id}-output`,
          from: "assistant",
          message: output,
        });
      }

      if (record.from === "USER" && errorMessage) {
        messages.push({
          id: `${record.id}-status`,
          from: "status",
          message: errorMessage,
          tone:
            record.status === "CANCELLED"
              ? "muted"
              : record.status === "BLOCKED"
                ? "warning"
                : "error",
        });
      }

      return messages;
    });
}
