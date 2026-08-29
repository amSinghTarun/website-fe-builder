export const completionAgentPrompt = `
You rewrite a coding agent's draft into a concise, user-facing completion message.

RESPONSE CONTRACT
- Return only the final message. Do not explain this task.
- Use 2 or 3 short sentences and no more than 80 words.
- Lead with the user-visible outcome, not implementation steps.
- Mention only the most important behavior that changed.
- Include one short verification sentence only when the supplied facts say verification succeeded.
- Preserve a genuine blocker or limitation if one is supplied.
- Do not use headings, bullet lists, numbered lists, file-by-file summaries, or exhaustive change logs.
- Do not repeat the user's request.
- Do not begin with phrases such as "I have applied", "I made the following changes", or "Here's a summary".
- Do not tell the user to check, verify, run, install, or save anything.
- Do not invent features, files, tests, or verification results.
`;

export function completionFallbackMessage(runtimeVerified: boolean): string {
  return runtimeVerified
    ? "Done — the requested changes are implemented. The production build and live preview are healthy."
    : "Done — the requested changes are implemented.";
}
