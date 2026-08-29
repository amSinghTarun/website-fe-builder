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
          errorMessage: null,
          status: "SUCCEEDED",
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
          errorMessage: null,
          status: null,
          createdAt: "2026-08-13T10:00:00.000Z",
        },
        {
          id: 1,
          contents: "   ",
          from: "USER",
          output: "First",
          errorMessage: null,
          status: "SUCCEEDED",
          createdAt: "2026-08-13T10:00:00.000Z",
        },
      ]),
    ).toEqual([
      { id: "1-output", from: "assistant", message: "First" },
      { id: "2", from: "assistant", message: "Second" },
    ]);
  });

  test("renders failed runs separately from assistant output", () => {
    expect(
      mapChatHistory([
        {
          id: 9,
          contents: "Update the dashboard",
          from: "USER",
          output: null,
          errorMessage: "The agent stream failed.",
          status: "FAILED",
          createdAt: "2026-08-13T10:00:00.000Z",
        },
        {
          id: 10,
          contents: "Stop generation",
          from: "USER",
          output: null,
          errorMessage: "Generation stopped by user.",
          status: "CANCELLED",
          createdAt: "2026-08-13T10:01:00.000Z",
        },
      ]),
    ).toEqual([
      { id: "9", from: "user", message: "Update the dashboard" },
      {
        id: "9-status",
        from: "status",
        message: "The agent stream failed.",
        tone: "error",
      },
      { id: "10", from: "user", message: "Stop generation" },
      {
        id: "10-status",
        from: "status",
        message: "Generation stopped by user.",
        tone: "muted",
      },
    ]);
  });
});
