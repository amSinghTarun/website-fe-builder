import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from "@google/genai";

const implementationToolNames = new Set([
  "createTaskPlan",
  "addTasksToPlan",
  "readDirectory",
  "readFileContent",
  "readContextArtifact",
  "createFile",
  "updateFile",
  "deleteFile",
  "executeBash",
  "createSubAgent",
]);

export function createGeminiGenerationConfig(args: {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  abortSignal?: AbortSignal;
  forceImplementationToolCall?: boolean;
}): GenerateContentConfig {
  const allowedFunctionNames = args.functionDeclarations.flatMap(
    (declaration) =>
      declaration.name && implementationToolNames.has(declaration.name)
        ? [declaration.name]
        : [],
  );
  const forceImplementationToolCall =
    args.forceImplementationToolCall === true &&
    allowedFunctionNames.length > 0;

  return {
    systemInstruction: args.systemInstruction,
    tools: [{ functionDeclarations: args.functionDeclarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: forceImplementationToolCall
          ? FunctionCallingConfigMode.ANY
          : FunctionCallingConfigMode.AUTO,
        ...(forceImplementationToolCall && { allowedFunctionNames }),
      },
    },
    ...(args.abortSignal && { abortSignal: args.abortSignal }),
  };
}
