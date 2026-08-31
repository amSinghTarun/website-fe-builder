import { describe, expect, test } from "bun:test";
import { FunctionCallingConfigMode, type FunctionDeclaration } from "@google/genai";
import { createGeminiGenerationConfig } from "./geminiConfig";

const declarations = [
  { name: "readFileContent" },
  { name: "updateFile" },
  { name: "executeBash" },
  { name: "takeUserInput" },
] as FunctionDeclaration[];

describe("createGeminiGenerationConfig", () => {
  test("uses AUTO during the normal first pass", () => {
    const config = createGeminiGenerationConfig({
      systemInstruction: "test",
      functionDeclarations: declarations,
    });

    expect(config.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.AUTO,
    );
    expect(
      config.toolConfig?.functionCallingConfig?.allowedFunctionNames,
    ).toBeUndefined();
  });

  test("forces only mutation-capable tools after a rejected prose response", () => {
    const config = createGeminiGenerationConfig({
      systemInstruction: "test",
      functionDeclarations: declarations,
      forceWorkspaceMutation: true,
    });

    expect(config.toolConfig?.functionCallingConfig?.mode).toBe(
      FunctionCallingConfigMode.ANY,
    );
    expect(
      config.toolConfig?.functionCallingConfig?.allowedFunctionNames,
    ).toEqual(["updateFile", "executeBash"]);
  });
});
