import { describe, expect, test } from "bun:test";
import { FunctionCallingConfigMode, type FunctionDeclaration } from "@google/genai";
import { createGeminiGenerationConfig } from "./geminiConfig";

const declarations = [
  { name: "createTaskPlan" },
  { name: "readDirectory" },
  { name: "updateFile" },
  { name: "takeUserInput" },
] as FunctionDeclaration[];

describe("Gemini generation config", () => {
  test("keeps chat tools and system instructions in per-request config", () => {
    const abortController = new AbortController();
    const config = createGeminiGenerationConfig({
      systemInstruction: "Build the selected frontend.",
      functionDeclarations: declarations,
      abortSignal: abortController.signal,
    });

    expect(config.systemInstruction).toBe("Build the selected frontend.");
    expect(config.tools).toEqual([{ functionDeclarations: declarations }]);
    expect(config.abortSignal).toBe(abortController.signal);
    expect(config.toolConfig?.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.AUTO,
    });
  });

  test("requires a workspace tool until an implementation changes files", () => {
    const config = createGeminiGenerationConfig({
      systemInstruction: "Build the selected frontend.",
      functionDeclarations: declarations,
      requireWorkspaceTool: true,
    });

    expect(config.toolConfig?.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ["createTaskPlan", "readDirectory", "updateFile"],
    });
  });

  test("can require a task plan before workspace implementation", () => {
    const config = createGeminiGenerationConfig({
      systemInstruction: "Build the selected frontend.",
      functionDeclarations: declarations,
      requireTaskPlan: true,
      requireWorkspaceTool: true,
    });

    expect(config.toolConfig?.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ["createTaskPlan"],
    });
  });
});
