import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  type GenerateContentConfig,
} from "@google/genai";

export function createGeminiGenerationConfig(args: {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
  abortSignal?: AbortSignal;
}): GenerateContentConfig {
  return {
    systemInstruction: args.systemInstruction,
    tools: [{ functionDeclarations: args.functionDeclarations }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
    },
    ...(args.abortSignal && { abortSignal: args.abortSignal }),
  };
}
