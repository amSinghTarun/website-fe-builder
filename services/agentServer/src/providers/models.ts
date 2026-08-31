function configuredModel(environmentName: string, fallback: string): string {
  return process.env[environmentName]?.trim() || fallback;
}

// Keep expensive implementation work separate from lightweight support calls.
export const implementationModel = configuredModel(
  "GEMINI_IMPLEMENTATION_MODEL",
  "gemini-3.5-flash",
);

export const supportModel = configuredModel(
  "GEMINI_SUPPORT_MODEL",
  "gemini-2.5-flash",
);
