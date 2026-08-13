import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from "@google/genai";

const implementationToolNames = new Set([
  "readDirectory",
  "readFileContent",
  "readContextArtifact",
  "createFile",
  "updateFile",
  "deleteFile",
  "executeBash",
]);

export function createGeminiGenerationConfig(args: {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  abortSignal?: AbortSignal;
  requireWorkspaceTool?: boolean;
}): GenerateContentConfig {
  const allowedFunctionNames = args.functionDeclarations.flatMap(
    (declaration) =>
      declaration.name && implementationToolNames.has(declaration.name)
        ? [declaration.name]
        : [],
  );
  const requireWorkspaceTool =
    args.requireWorkspaceTool === true && allowedFunctionNames.length > 0;

  return {
    systemInstruction: args.systemInstruction,
    tools: [{ functionDeclarations: args.functionDeclarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: requireWorkspaceTool
          ? FunctionCallingConfigMode.ANY
          : FunctionCallingConfigMode.AUTO,
        ...(requireWorkspaceTool && { allowedFunctionNames }),
      },
    },
    ...(args.abortSignal && { abortSignal: args.abortSignal }),
  };
}
