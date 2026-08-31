import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from "@google/genai";

const workspaceMutationToolNames = new Set([
  "createFile",
  "updateFile",
  "deleteFile",
  "executeBash",
]);

export function createGeminiGenerationConfig(args: {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  abortSignal?: AbortSignal;
  forceWorkspaceMutation?: boolean;
}): GenerateContentConfig {
  const allowedFunctionNames = args.functionDeclarations.flatMap(
    (declaration) =>
      declaration.name && workspaceMutationToolNames.has(declaration.name)
        ? [declaration.name]
        : [],
  );
  const forceWorkspaceMutation =
    args.forceWorkspaceMutation === true && allowedFunctionNames.length > 0;

  return {
    systemInstruction: args.systemInstruction,
    tools: [{ functionDeclarations: args.functionDeclarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: forceWorkspaceMutation
          ? FunctionCallingConfigMode.ANY
          : FunctionCallingConfigMode.AUTO,
        ...(forceWorkspaceMutation && { allowedFunctionNames }),
      },
    },
    ...(args.abortSignal && { abortSignal: args.abortSignal }),
  };
}
