// import { geminiAgent } from "./providers/index.js";

// import { type Content } from "@google/genai";

// export const chat = async (
//   message: string,
//   projectId: string,
// ): Promise<{
//   stream: AsyncGenerator<string>;
//   finalHistoryPromise: Promise<Content[]>;
// }> => {
//   try {
//     const { textStream, finalHistory } = await geminiAgent({
//       prompt: message,
//       history: history[projectId],
//     });

//     finalHistoryPromise
//       .then(async (finalHistory) => {
//         await setSessionHistory(finalHistory, sessionId);
//       })
//       .catch((error) => {
//         console.error("Error saving session history:", error);
//       });

//     return { stream: textStream, finalHistoryPromise };
//   } catch (error: any) {
//     throw error;
//   }
// };
