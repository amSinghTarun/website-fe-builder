import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  type Chat,
  type PartListUnion,
  type SendMessageParameters,
  type Content,
} from "@google/genai";
import { tools, mergeWorktree } from "../tools";
import "dotenv/config";
import { rejectSubAgent, resolveSubAgent, subAgents } from "../helper";
import path from "node:path";
import os from "node:os";
import fs, { writeFileSync } from "node:fs";
import { summariseAgentPrompt, defaultSystemPrompt } from "../systemPrompts";
import { randomUUID } from "node:crypto";
import { prisma } from "@sky/db";

export class GeminiProvider {
  private static sessions: {
    [projectId: string]: { chat: Chat; contextualiseCount?: number };
  } = {};
  public cwd: string;
  public static newMessages: Map<string, SendMessageParameters[]> = new Map([]);

  private static geminiClient = new GoogleGenAI({
    vertexai: true,
    project: process.env["GCP_PROJECT_ID"]!,
  });

  private projectId: string = "";

  public constructor(projectId: string, systemPrompt?: string, cwd?: string) {
    this.projectId = projectId;
    this.cwd = cwd ?? "";
    if (!GeminiProvider.sessions[this.projectId])
      GeminiProvider.sessions[this.projectId] = {
        chat: this.createNewSession({ newSystemPrompt: systemPrompt }),
        contextualiseCount: 0,
      };
  }

  private createNewSession(args: {
    newSystemPrompt?: string;
    history?: Content[];
  }) {
    let session = GeminiProvider.geminiClient.chats.create({
      model: "gemini-2.5-flash",
      history: args.history ?? [],
      config: {
        systemInstruction: args.newSystemPrompt ?? defaultSystemPrompt,
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
        tools: [
          {
            functionDeclarations: Object.entries(tools).map(
              ([_name, tool], _index) => tool.declaration,
            ),
          },
        ],
      },
    });
    return session;
  }

  private static async summariseChat(history: Content[]): Promise<string> {
    // initialise a new chat agent with summarise system prompt
    let summariseAgent = new GeminiProvider(randomUUID(), summariseAgentPrompt);
    let { summary } = await summariseAgent.agentLoop({
      id: randomUUID(),
      message: JSON.stringify(history),
      handler: {},
    });
    console.log("New Summary : ", summary);
    return summary;
  }

  private static async contextualiseChat(
    history: Content[],
    projectId: string,
  ): Promise<{ contextedCount: number; history: Content[] }> {
    for (let content of history) {
      if (content.role == "user" || !content.parts) continue;

      let counter = 0;
      for (let part of content.parts) {
        if (!part.functionCall) continue;

        if (part.functionCall.name == "updateFile") {
          const currentContent = part.functionCall.args?.content as
            | string
            | undefined;

          // console.log("\n\n\n ", currentContent);
          if (currentContent && currentContent.length > 150) {
            // console.log("\n\n •••••••••• this one selected");
            let filePath = path.join(
              os.homedir(),
              ".loveable-contest",
              projectId,
            );
            let fileName = `${Date.now()}_${counter++}.md`;
            let dirExist = fs.existsSync(filePath);
            if (!dirExist) fs.mkdirSync(filePath, { recursive: true });
            writeFileSync(
              path.join(filePath, fileName),
              JSON.stringify(currentContent),
            );
            part.functionCall.args!.content = `Read file at ${path.join(filePath, fileName)}, to see the content of this update/write functionalCall`;
          }
        }
      }
    }

    let contextedCount =
      GeminiProvider.sessions[projectId]?.contextualiseCount ?? 0;

    return { contextedCount, history };
  }

  private async agentLoop(args: {
    id: string;
    message: string;
    handler: {
      onChunk?: (chunk: { type: string; response: any; uuid?: string }) => void;
      onFinish?: () => void;
    };
  }) {
    let summary = "";
    let dbConverstaionId;
    try {
      let newMessage: PartListUnion = [{ text: args.message }];
      let subAgentResponse: PartListUnion = [];
      let hasToolCall = true;

      // only store function calls for main agent and not for sub-agents
      if (args.id == "1")
        dbConverstaionId = await prisma.conversationHistory.create({
          data: {
            completed: false,
            contents: args.message,
            from: "USER",
            projectId: this.projectId,
            snapshotCaptured: false,
            type: "TEXT_MESSAGE",
            output: summary,
          },
          select: {
            id: true,
          },
        });

      let activeTaskPlan: string[] | null = null;
      let completedTaskIds = new Set<string>();

      while (hasToolCall) {
        let streamResponse;
        try {
          console.log("\n\n\n------------------------------------");

          let currentHistory =
            GeminiProvider.sessions[this.projectId]!.chat.getHistory();
          if (currentHistory.length) {
            let sessionTokens =
              await GeminiProvider.geminiClient.models.countTokens({
                model: "gemini-2.5-flash",
                contents: currentHistory,
              });

            // only contextualiseChat
            if ((sessionTokens?.totalTokens ?? 0) >= 1000) {
              let inLoopContextualiseChat =
                await GeminiProvider.contextualiseChat(
                  currentHistory,
                  this.projectId,
                );

              GeminiProvider.sessions[this.projectId] = {
                chat: this.createNewSession({
                  history: inLoopContextualiseChat.history,
                }),
                contextualiseCount: ++inLoopContextualiseChat.contextedCount,
              };
            }
          }

          let messageForStream = {
            message: [...newMessage, ...subAgentResponse],
          };

          // console.log(args.id, " - MESSAGE TO LLM : ", messageForStream);

          subAgentResponse = [];

          streamResponse =
            await GeminiProvider.sessions[
              this.projectId
            ]!.chat.sendMessageStream(messageForStream);
        } catch (error: any) {
          console.log(args.id, " - ", error);
          const errorMessage =
            error.status === 429
              ? "Limit reached, try after a minute"
              : `Error: ${error.message || JSON.stringify(error)}`;
          args.handler.onChunk &&
            args.handler.onChunk({ type: "error", response: errorMessage });
          hasToolCall = false;
          break;
        }

        for await (let response of streamResponse) {
          hasToolCall = false;

          if (response.functionCalls && response.functionCalls.length > 0) {
            let functionCallResponses: PartListUnion = [];

            let subAgentToolCalls = [];

            for (let functionCall of response.functionCalls) {
              // console.log("FUNCTION NAME : ", functionCall.name);
              try {
                const tool = tools[functionCall.name as keyof typeof tools];

                if (!tool) {
                  functionCallResponses.push({
                    functionResponse: {
                      ...(functionCall.id && { id: functionCall.id }),
                      name: functionCall.name,
                      response: {
                        output: "No such tool exist",
                      },
                    },
                  });
                  continue;
                }

                const output = (await tool.executable(
                  {
                    ...(functionCall.args as any),
                  },
                  { cwd: this.cwd },
                )) as {
                  response: string;
                  yield?: {
                    type: string;
                    response: any;
                    resolver?: any;
                    uuid?: string;
                  };
                };

                // Do Prisma Call Here
                if (+args.id == 1)
                  // only store function calls for main agent and not for sub-agents
                  await prisma.conversationHistory.create({
                    data: {
                      contents: `${functionCall.args}`,
                      from: "ASSISTANT",
                      toolCall: tool.identifier,
                      projectId: this.projectId,
                      type: "TOOL_CALL",
                      output: JSON.stringify({
                        type: output.yield?.type,
                        response: output.yield?.response,
                      }),
                    },
                  });

                if (tool.declaration.name == "createSubAgent") {
                  let provisionOutput = output as {
                    response: string;
                    workspacePath?: string;
                    yield?: { type: string; response: any };
                  };
                  if (provisionOutput.workspacePath) {
                    let newProjectId = `${this.projectId} + ${functionCall.args?.id}`;
                    let subAgentSession = new GeminiProvider(
                      newProjectId,
                      functionCall.args?.systemPrompt as string,
                      provisionOutput.workspacePath,
                    );
                    subAgentToolCalls.push(
                      subAgentSession.agentLoop({
                        id: functionCall.args?.id as string,
                        message: functionCall.args?.prompt as string,
                        handler: { onChunk: args.handler.onChunk },
                      }),
                    );
                  }
                } else if (tool.declaration.name === "createTaskPlan") {
                  activeTaskPlan =
                    (functionCall.args?.taskList as any[]).map((t) => t.id) ??
                    [];
                  completedTaskIds = new Set();
                } else if (
                  tool.declaration.name === "informCompletedTaskFromTaskPlan"
                ) {
                  completedTaskIds.add(functionCall.args?.id as string);
                }

                if (output.yield) {
                  args.handler.onChunk &&
                    args.handler.onChunk({
                      type: output.yield.type,
                      response: output.yield.response,
                      uuid: output.yield.uuid,
                    });

                  if (output.yield?.resolver)
                    output.response = await output.yield.resolver;
                }

                functionCallResponses.push({
                  functionResponse: {
                    ...(functionCall.id && { id: functionCall.id }),
                    name: functionCall.name,
                    response: {
                      output: output.response,
                    },
                  },
                });
              } catch (error: any) {
                functionCallResponses.push({
                  functionResponse: {
                    ...(functionCall.id && { id: functionCall.id }),
                    name: functionCall.name,
                    response: {
                      output:
                        error instanceof Error
                          ? error.message
                          : JSON.stringify(error),
                    },
                  },
                });
              }

              hasToolCall = true;
            }

            subAgentToolCalls.length &&
              Promise.all(subAgentToolCalls).then((responses) => {
                // loop through responses and merge the sub-agent into main and call rejectSubAgent, resolveSubAgent
                responses.map((response) => {
                  mergeWorktree({
                    id: response.id,
                    targetBranch: "main",
                    mainWorktreePath: this.cwd || process.cwd(),
                  })
                    .then((reply: any) => {
                      resolveSubAgent(response.id, {
                        summary: response.summary,
                        ...reply,
                      });
                    })
                    .catch((error: any) => {
                      rejectSubAgent(response.id, error);
                    });
                });
              });

            newMessage = functionCallResponses;
          }

          if (
            !hasToolCall &&
            activeTaskPlan &&
            completedTaskIds.size < activeTaskPlan.length &&
            Object.keys(subAgents).length > 0
          ) {
            const remaining = activeTaskPlan.filter(
              (id) => !completedTaskIds.has(id),
            );
            newMessage = [
              {
                text: `You still have ${remaining.length} unfinished task(s) from your plan (${remaining.join(", ")}). Continue working on them, or call informCompletedTaskFromTaskPlan / explain why they can't be completed.`,
              },
            ];
            if (Object.keys(subAgents).length > 0) {
              newMessage = [
                ...newMessage,
                {
                  text: `You still have ${remaining.length} unfinished agents(s). Continue working on them, or call waitForSubAgent / explain why they can't be completed.`,
                },
              ];
            }
            hasToolCall = true; // force another turn instead of exiting
          }

          args.handler.onChunk &&
            args.handler.onChunk({
              type: "message",
              response: response.text,
            });
          summary += ` ${response.text ?? ""}`;
        }
      }

      let history = GeminiProvider.sessions[this.projectId]!.chat.getHistory();

      let sessionTokens = await GeminiProvider.geminiClient.models.countTokens({
        model: "gemini-2.5-flash",
        contents: history,
      });

      // console.log(sessionTokens?.totalTokens ?? 0, history);

      if (args.id !== "1") {
        return {
          history: history,
          id: args?.id ?? "",
          summary: summary,
        };
      }

      if ((sessionTokens?.totalTokens ?? 0) > 1000) {
        let { contextedCount, history: newHistory } =
          await GeminiProvider.contextualiseChat(history, this.projectId);
        if (contextedCount >= 3) {
          let sessionSummary = await GeminiProvider.summariseChat(history);

          GeminiProvider.sessions[this.projectId] = {
            chat: this.createNewSession({
              newSystemPrompt: sessionSummary,
            }),
            contextualiseCount: 0,
          };
        } else {
          GeminiProvider.sessions[this.projectId] = {
            chat: this.createNewSession({
              history: newHistory,
            }),
            contextualiseCount: ++contextedCount,
          };
        }
      }
      await prisma.conversationHistory.update({
        where: {
          id: dbConverstaionId!.id,
        },
        data: {
          completed: true,
          output: summary,
        },
      });
      let sessionTokens1 = await GeminiProvider.geminiClient.models.countTokens(
        {
          model: "gemini-2.5-flash",
          contents: history,
        },
      );

      console.log(
        "BEFORE : ",
        sessionTokens.totalTokens,
        " || ",
        "AFTER : ",
        sessionTokens1.totalTokens,
      );

      // GeminiProvider.sessions[this.projectId]!.chat = GeminiProvider.sessions[this.projectId]!.chat;

      args.handler.onFinish && args.handler.onFinish();
      return {
        history: history,
        id: args?.id ?? "",
        summary: summary,
      };
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  public async agentSync(args: { id: string; message: string }) {
    return await this.agentLoop({
      message: args.message,
      id: args.id,
      handler: {},
    });
  }

  public async *agentStream(args: { id: string; message: string }) {
    try {
      let controller: ReadableStreamDefaultController<any>;

      const stream = new ReadableStream({
        start(c) {
          controller = c;
        },
      });

      let onChunk = (args: { type: string; response: any; uuid?: string }) => {
        controller.enqueue(args);
      };

      let onFinish = () => {
        controller.close();
      };

      this.agentLoop({
        message: args.message,
        id: args.id,
        handler: {
          onChunk: onChunk,
          onFinish: onFinish,
        },
      });

      let reader = stream.getReader();
      while (true) {
        let { done, value } = await reader.read();
        if (done) {
          console.log("Agent is done");
          break;
        }
        yield value;
      }
    } catch (error) {
      throw error;
    }
  }
}

// let session: {
//   [projectId: string]: { state: "WAITING" | "OPEN"; chat: Chat };
// } = {};

// const geminiClient = new GoogleGenAI({
//   vertexai: true,
//   project: process.env["PROJECT_ID"]!,
// });

// export const geminiAgent = async (args: {
//   id?: string;
//   prompt: string;
//   projectId: string;
//   systemPrompt: string;
//   onComplete?: (args: { history: any; summary: string; id: string }) => void;
// }) => {
// const chatSession = session[args.projectId]
//   ? session[args.projectId]?.chat
//   : geminiClient.chats.create({
//       model: "gemini-2.5-flash",
//       config: {
//         systemInstruction:
//           args.systemPrompt !== ""
//             ? args.systemPrompt
//             : `
//               Working directory is './projects'. Whatever you create or read, it should be done in ./projects directory only.
//               You are a senior software engineering agent. Analyse the input given by the user correctly and only act based on what has user told you to do.
//               Complete the user's objective with minimal supervision while maintaining correctness and safety and using the approapriate tolos.
//               There are bunch of tools available for you to use, use them wherever you deem it suitable, but don't use tools unnecessarily.
//               On every user message figure out if the task specifed in it can be broken into small steps, if it can be then use the createTaskPlan to create a plan for the task. Don't break the task in too many small tasks, keep the considerably broad like create this file, add this functionality.
//               You can create agents and spawn sub-task to them, if you want to break a task into multiple pieces or if you want to use agent for steps of plan created by createTaskPlan.
//             `,
//         //             Use takeUserInput tool if you want to ask anything to the user.

//         toolConfig: {
//           functionCallingConfig: {
//             mode: FunctionCallingConfigMode.AUTO,
//           },
//         },
//         tools: [
//           {
//             functionDeclarations: Object.entries(tools).map(
//               ([_name, tool], _index) => tool.declaration,
//             ),
//           },
//         ],
//       },
//     });

// newMessages.push({
//   message: args.prompt,
// });

// let resolveHistory = (history: Content[]): void => {};
// let finalHistory = new Promise<Content[]>(
//   (resolve) => (resolveHistory = resolve),
// );

// const textStream = (async function* (): AsyncGenerator<{
//   type: string;
//   response: Array<string> | string;
//   uuid?: string;
// }> {
// try {
//   let hasToolCall = true;
//   while (hasToolCall) {
//     for (let newMessage of newMessages) {
//       let streamResponse;
//       try {
//         console.log(args.id, " - MESSAGE TO LLM : ", newMessage);
//         streamResponse = await chatSession!.sendMessageStream(newMessage);
//       } catch (error: any) {
//         console.log(args.id, " - ", error);
//         const errorMessage =
//           error.status === 429
//             ? "Limit reached, try after a minute"
//             : `Error: ${error.message || JSON.stringify(error)}`;
//         yield { type: "error", response: errorMessage };
//         hasToolCall = false;
//         break;
//       }
//       for await (let response of streamResponse) {
//         hasToolCall = false;
//         if (response.functionCalls && response.functionCalls.length > 0) {
//           let functionCallResponses: PartListUnion = [];
//           for (let functionCall of response.functionCalls) {
//             console.log("------------", functionCall.name);
//             try {
//               const tool = tools[functionCall.name as keyof typeof tools];
//               if (!tool) {
//                 functionCallResponses.push({
//                   functionResponse: {
//                     ...(functionCall.id && { id: functionCall.id }),
//                     name: functionCall.name,
//                     response: {
//                       output: "No such tool exist",
//                     },
//                   },
//                 });
//                 continue;
//               }
//               if (tool.declaration.name == "createSubAgent") {
//                 console.log("creating sub agents", functionCall.args?.id);
//                 // let subAgentHistory = await geminiAgent({
//                 //   id: functionCall.args?.id as string,
//                 //   prompt: functionCall.args?.systemPrompt as string,
//                 //   systemPrompt: functionCall.args?.systemPrompt as string,
//                 //   projectId: args.projectId,
//                 // });
//                 // subAgentToolCalls.push(subAgentHistory.finalHistory);
//               }
//               const output = tool.executable({
//                 ...(functionCall.args as any),
//                 projectId: args.projectId,
//               }) as {
//                 response: string;
//                 yield?: {
//                   type: string;
//                   response: any;
//                   resolver?: any;
//                   uuid?: string;
//                 };
//               };
//               if (output.yield) {
//                 yield {
//                   type: output.yield.type,
//                   response: output.yield.response,
//                   uuid: output.yield.uuid,
//                 };
//                 if (output.yield?.resolver)
//                   output.response = await output.yield.resolver;
//               }
//               functionCallResponses.push({
//                 functionResponse: {
//                   ...(functionCall.id && { id: functionCall.id }),
//                   name: functionCall.name,
//                   response: {
//                     output: output.response,
//                   },
//                 },
//               });
//             } catch (error: any) {
//               functionCallResponses.push({
//                 functionResponse: {
//                   ...(functionCall.id && { id: functionCall.id }),
//                   name: functionCall.name,
//                   response: {
//                     output:
//                       error instanceof Error
//                         ? error.message
//                         : JSON.stringify(error),
//                   },
//                 },
//               });
//             }
//             hasToolCall = true;
//           }
//           // do we need to have weights in agents?
//           // if (subAgentToolCalls.length)
//           //   Promise.all(subAgentToolCalls).then(async (subSgentResults) => {
//           //     console.log("Sub-agent response");
//           //   });
//           session[args.projectId] = {
//             chat: chatSession!,
//             state: "OPEN",
//           };
//           newMessages.push({ message: functionCallResponses });
//         }
//       }
//     }
//   }
// } finally {
//   resolveHistory(chatSession!.getHistory());
//   if (args.onComplete) {
//     args.onComplete({
//       id: args.id ?? "",
//       history: finalHistory,
//       summary: "",
//     });
//   }
//   return;
// }
//   })();

//   return { textStream, finalHistory, id: args.id ?? "" };
// };
