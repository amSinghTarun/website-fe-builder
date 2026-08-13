import { describe, expect, test } from "bun:test";
import { mapChatHistory } from "./chatHistory.ts";

describe("persisted chat history", () => {
  test("restores user prompts and their saved agent responses", () => {
    expect(
      mapChatHistory([
        {
          id: 7,
          contents: "Build a kanban board",
          from: "USER",
          output: "Created the board and verified the preview.",
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      ]),
    ).toEqual([
      { id: "7", from: "user", message: "Build a kanban board" },
      {
        id: "7-output",
        from: "assistant",
        message: "Created the board and verified the preview.",
      },
    ]);
  });

  test("orders records deterministically and skips empty bubbles", () => {
    expect(
      mapChatHistory([
        {
          id: 2,
          contents: "Second",
          from: "ASSISTANT",
          output: null,
          createdAt: "2026-08-13T10:00:00.000Z",
        },
        {
          id: 1,
          contents: "   ",
          from: "USER",
          output: "First",
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      ]),
    ).toEqual([
      { id: "1-output", from: "assistant", message: "First" },
      { id: "2", from: "assistant", message: "Second" },
    ]);
  });
});
