import {
  GoogleGenAI,
  type Chat,
  type FunctionDeclaration,
  type PartListUnion,
  type Content,
} from "@google/genai";
import { getTool, tools } from "../tools";
import "dotenv/config";
import { removeInputRequest } from "../inputRequestRegistry";
import { subAgentRegistry } from "../subAgents/registry";
import {
  createFrontendSystemPrompt,
  completionAgentPrompt,
  completionFallbackMessage,
  intentClassifierPrompt,
  summariseAgentPrompt,
  type FrontendLibrary,
  type RequestIntentResult,
} from "../systemPrompts";
import { prisma, type ConversationRunStatus } from "@sky/db";
import {
  getConfiguredAppRuntimeMonitor,
  type AppRuntimeState,
  validateFrontendBrowser,
  validateFrontendBuild,
  validateFrontendLint,
  validateFrontendQuality,
  fingerprintWorkspace,
  formatRuntimeObservation,
} from "../runtime";
import {
  archiveLargeUpdateFileArguments,
  getContextArchiveConfig,
} from "../context/contextArchive";
import {
  AgentRunCancelledError,
  abortable,
  throwIfRunCancelled,
} from "../runtime/AgentRunRegistry";
import { createGeminiGenerationConfig } from "./geminiConfig";
import {
  applyTaskPlanToolCall,
  delegatedResultsChangedWorkspace,
  delegatedResultsMessage,
  emitToolActivity,
  evaluateRuntimeRepair,
  type AgentChunk,
  type PlanTask,
} from "../agentLoop/helpers";
import { startSubAgentLifecycle } from "../subAgents/lifecycle";
import { serializeAuditPayload } from "../agentLoop/audit";
import { implementationModel, supportModel } from "./models";

const CONTEXT_COMPACTION_TOKEN_THRESHOLD = 20_000;
const IMPLEMENTATION_CONFIDENCE_THRESHOLD = 0.7;
const MAX_NO_MUTATION_RETRIES = 2;

export class GeminiProvider {
  private static sessions: {
    [sessionKey: string]: {
      chat: Chat;
      systemInstruction: string;
      contextualiseCount?: number;
      persistentSummary?: string;
      summarizedThroughHistoryId?: number;
    };
  } = {};
  private static sessionRestores = new Map<string, Promise<void>>();
  public cwd: string;
  private static geminiClient = new GoogleGenAI({
    vertexai: true,
    project: process.env["GCP_PROJECT_ID"]!,
  });

  private projectId: string = "";
  private sessionKey: string;
  private frontendLibrary: FrontendLibrary;
  private createdSession = false;

  public static async create(
    projectId: string,
    frontendLibrary: FrontendLibrary,
    systemPrompt?: string,
    cwd?: string,
    sessionKey?: string,
  ): Promise<GeminiProvider> {
    const provider = new GeminiProvider(
      projectId,
      frontendLibrary,
      systemPrompt,
      cwd,
      sessionKey,
    );
    if (provider.sessionKey === projectId) {
      let restore = GeminiProvider.sessionRestores.get(provider.sessionKey);
      if (provider.createdSession) {
        restore = provider.restoreMainSession();
        GeminiProvider.sessionRestores.set(provider.sessionKey, restore);
      }

      if (!restore) return provider;
      try {
        await restore;
      } catch (error) {
        delete GeminiProvider.sessions[provider.sessionKey];
        throw error;
      } finally {
        if (
          GeminiProvider.sessionRestores.get(provider.sessionKey) === restore
        ) {
          GeminiProvider.sessionRestores.delete(provider.sessionKey);
        }
      }
    }
    return provider;
  }

  public constructor(
    projectId: string,
    frontendLibrary: FrontendLibrary,
    systemPrompt?: string,
    cwd?: string,
    sessionKey?: string,
  ) {
    this.projectId = projectId;
    this.frontendLibrary = frontendLibrary;
    this.sessionKey = sessionKey ?? projectId;
    this.cwd = cwd ?? "";
    if (!GeminiProvider.sessions[this.sessionKey]) {
      GeminiProvider.sessions[this.sessionKey] = {
        ...this.createNewSession({ newSystemPrompt: systemPrompt }),
        contextualiseCount: 0,
      };
      this.createdSession = true;
    }
  }

  private async restoreMainSession(): Promise<void> {
    const memory = await prisma.agentMemory.findUnique({
      where: { projectId: this.projectId },
    });
    const recentTurns = await prisma.conversationHistory.findMany({
      where: {
        projectId: this.projectId,
        id: { gt: memory?.summarizedThroughHistoryId ?? 0 },
        type: "TEXT_MESSAGE",
        from: "USER",
        output: { not: null },
        AND: [
          { OR: [{ agentId: "1" }, { agentId: null }] },
          {
            OR: [{ status: "SUCCEEDED" }, { status: null, completed: true }],
          },
        ],
      },
      orderBy: { id: "asc" },
      select: {
        contents: true,
        output: true,
        rawOutput: true,
      },
    });

    const history: Content[] = recentTurns.flatMap((turn) => {
      const assistantMessage = turn.rawOutput?.trim() || turn.output?.trim();
      if (!assistantMessage) return [];
      return [
        { role: "user", parts: [{ text: turn.contents }] },
        { role: "model", parts: [{ text: assistantMessage }] },
      ];
    });

    GeminiProvider.sessions[this.sessionKey] = {
      ...this.createNewSession({
        newSystemPrompt: memory?.summary,
        history,
      }),
      contextualiseCount: 0,
      persistentSummary: memory?.summary,
      summarizedThroughHistoryId: memory?.summarizedThroughHistoryId,
    };
  }

  private functionDeclarations(): FunctionDeclaration[] {
    return Object.values(tools).map((tool) => tool.declaration);
  }

  private createNewSession(args: {
    newSystemPrompt?: string;
    history?: Content[];
  }): { chat: Chat; systemInstruction: string } {
    const systemInstruction = createFrontendSystemPrompt(
      this.frontendLibrary,
      args.newSystemPrompt,
    );
    const chat = GeminiProvider.geminiClient.chats.create({
      model: implementationModel,
      history: args.history ?? [],
      config: createGeminiGenerationConfig({
        systemInstruction,
        functionDeclarations: this.functionDeclarations(),
      }),
    });
    return { chat, systemInstruction };
  }

  // Run only after AUTO returns prose without changing an implementation request.
  private static async classifyRequestIntent(
    message: string,
    signal?: AbortSignal,
  ): Promise<RequestIntentResult> {
    try {
      const response = await GeminiProvider.geminiClient.models.generateContent({
        model: supportModel,
        contents: JSON.stringify({ userMessage: message }),
        config: {
          systemInstruction: intentClassifierPrompt,
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              intent: {
                type: "string",
                enum: ["implementation", "informational", "ambiguous"],
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
            required: ["intent", "confidence", "reason"],
            additionalProperties: false,
          },
          temperature: 0,
          maxOutputTokens: 160,
          ...(signal && { abortSignal: signal }),
        },
      });

      if (!response.text?.trim()) {
        return {
          intent: "ambiguous",
          confidence: 0,
          reason: "No classifier response",
        };
      }

      const parsed = JSON.parse(response.text) as RequestIntentResult;
      const confidence = Number(parsed.confidence);
      return {
        intent:
          parsed.intent === "implementation" || parsed.intent === "informational"
            ? parsed.intent
            : "ambiguous",
        confidence: Number.isFinite(confidence)
          ? Math.min(1, Math.max(0, confidence))
          : 0,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    } catch (error) {
      if (signal?.aborted) throw new AgentRunCancelledError();
      console.error("Unable to classify request intent:", error);
      return {
        intent: "ambiguous",
        confidence: 0,
        reason: "Classifier unavailable",
      };
    }
  }

  // Store internal diagnostics as non-replayable LOOP records for later audits.
  private async persistRunEvent(args: {
    runId: number;
    agentId: string;
    event: string;
    payload: unknown;
  }): Promise<void> {
    try {
      await prisma.conversationHistory.create({
        data: {
          projectId: this.projectId,
          agentId: args.agentId,
          from: "LOOP",
          type: "TOOL_CALL",
          toolCall: args.event,
          contents: JSON.stringify({ runId: args.runId, event: args.event }),
          output: serializeAuditPayload(args.payload),
        },
      });
    } catch (error) {
      console.error(`Unable to persist ${args.event}:`, error);
    }
  }

  private static async summariseChat(
    history: Content[],
    previousSummary?: string,
  ): Promise<string> {
    const summariseAgent = GeminiProvider.geminiClient.chats.create({
      model: supportModel,
      config: {
        systemInstruction: summariseAgentPrompt,
      },
    });
    const response = await summariseAgent.sendMessage({
      message: JSON.stringify({
        previousSummary: previousSummary || null,
        recentHistory: history,
      }),
    });
    const summary = response.text ?? "Unable to summarize previous context.";
    return summary;
  }

  private static contextualiseChat(
    history: Content[],
    sessionKey: string,
    databaseProjectId: string,
  ): { contextedCount: number; history: Content[] } {
    const archiveConfig = getContextArchiveConfig({ databaseProjectId });
    const contextualizedHistory = archiveLargeUpdateFileArguments(
      history,
      archiveConfig,
    );

    const contextedCount =
      GeminiProvider.sessions[sessionKey]?.contextualiseCount ?? 0;

    return { contextedCount, history: contextualizedHistory };
  }

  private static async rewriteCompletionMessageAgent(args: {
    userRequest: string;
    draft: string;
    workspaceChanged: boolean;
    runtimeVerified: boolean;
  }): Promise<string> {
    try {
      const completionAgent = GeminiProvider.geminiClient.chats.create({
        model: supportModel,
        config: { systemInstruction: completionAgentPrompt },
      });
      const response = await completionAgent.sendMessage({
        message: JSON.stringify({
          userRequest: args.userRequest,
          draft: args.draft,
          verifiedFacts: {
            workspaceChanged: args.workspaceChanged,
            productionBuildAndPreviewHealthy: args.runtimeVerified,
          },
        }),
      });
      return (
        response.text?.trim() ?? completionFallbackMessage(args.runtimeVerified)
      );
    } catch (error) {
      console.error("Unable to format completion message:", error);
      return completionFallbackMessage(args.runtimeVerified);
    }
  }

  private async observeRuntime(
    handler: {
      onChunk?: (chunk: { type: string; response: any; uuid?: string }) => void;
    },
    validation: "runtime" | "diagnostic" | "functional" | "completion" = "runtime",
    signal?: AbortSignal,
    audit?: { runId: number; agentId: string },
  ): Promise<AppRuntimeState | undefined> {
    const configured = getConfiguredAppRuntimeMonitor(this.projectId);

    if (!configured || configured.ref.databaseProjectId !== this.projectId) {
      return undefined;
    }

    let state = await configured.monitor.waitForSettledState(configured.ref);

    const workspaceOptions = {
      databaseProjectId: this.projectId,
      namespace: configured.ref.namespace,
      containerName: configured.ref.containerName,
      workingDirectory:
        process.env["WORKSPACE_CONTAINER_PATH"]?.trim() || "/app/my-app",
      signal,
    };

    // HTTP 200 only proves Vite served its shell. Strict lint catches browser
    // failures such as undefined JSX components before Gemini may answer.
    if (validation !== "runtime" && state.status === "running") {
      state =
        (await validateFrontendLint(workspaceOptions)) ?? state;
    }

    if (
      (validation === "functional" || validation === "completion") &&
      state.status === "running"
    ) {
      state = (await validateFrontendBuild(workspaceOptions)) ?? state;
    }

    if (validation !== "runtime" && state.status === "running") {
      const publicHost = configured.ref.httpHost?.trim();
      const internalHostname = `${configured.ref.serviceName}.${configured.ref.namespace}.svc.cluster.local`;
      const previewUrl = publicHost
        ? `http://${publicHost}:${configured.ref.servicePort}${configured.ref.httpPath ?? "/"}`
        : `http://${internalHostname}:${configured.ref.servicePort}${configured.ref.httpPath ?? "/"}`;
      state =
        (await validateFrontendBrowser({
          url: previewUrl,
          internalHostname: publicHost ? internalHostname : undefined,
          signal,
        })) ?? state;
    }

    if (validation === "completion" && state.status === "running") {
      state =
        (await validateFrontendQuality(
          this.cwd || configured.ref.workspacePath,
        )) ?? state;
    }

    handler.onChunk?.({ type: "runtime", response: state });
    if (audit) {
      await this.persistRunEvent({
        ...audit,
        event: "runtimeObservation",
        payload: { validation, state },
      });
    }
    return state;
  }

  private async agentLoop(args: {
    id: string;
    message: string;
    handler: {
      onChunk?: (chunk: AgentChunk) => void;
      onFinish?: () => void;
    };
    signal?: AbortSignal;
  }) {
    let finalOutput = "";
    let rawFinalOutput = "";
    let runStatus: ConversationRunStatus = "RUNNING";
    let runError: string | null = null;
    let conversationRecord: { id: number } | undefined;
    try {
      let newMessage: PartListUnion = [{ text: args.message }];
      let hasToolCall = true;
      const initialWorkspaceFingerprint =
        args.id === "1" ? await fingerprintWorkspace(this.cwd) : undefined;

      // Persist the raw user turn before starting any model or tool work.
      conversationRecord = await prisma.conversationHistory.create({
        data: {
          contents: args.message,
          from: "USER",
          projectId: this.projectId,
          snapshotCaptured: false,
          type: "TEXT_MESSAGE",
          output: null,
          rawOutput: null,
          errorMessage: null,
          status: runStatus,
          completed: false,
          agentId: args.id,
        },
        select: {
          id: true,
        },
      });

      const activeTaskPlan = new Map<string, PlanTask>();
      const completedTaskIds = new Set<string>();
      let workspaceChanged = false;
      let runtimeVerified = false;
      let requestIntent: RequestIntentResult | undefined;
      let forceWorkspaceMutation = false;
      let noMutationRetries = 0;
      let toolActivitySequence = 0;
      const repairAttemptsByFingerprint = new Map<string, number>();

      const runtimeRepairMessage = async (
        runtimeState: Awaited<ReturnType<typeof this.observeRuntime>>,
      ): Promise<string | undefined> => {
        const decision = evaluateRuntimeRepair(
          runtimeState,
          repairAttemptsByFingerprint,
        );
        if (decision.action !== "none") {
          await this.persistRunEvent({
            runId: conversationRecord!.id,
            agentId: args.id,
            event: "runtimeRepairAttempt",
            payload: { decision, runtimeState },
          });
        }
        if (decision.action === "retry") return decision.message;
        if (decision.action !== "blocked") return undefined;

        runStatus = "BLOCKED";
        runError = decision.message;
        args.handler.onChunk?.({
          type: "runtimeBlocked",
          response: runtimeState,
        });
        return undefined;
      };

      // Inspect every main-agent request before Gemini answers. This catches
      // existing runtime and lint failures even when the user only asks why.
      if (args.id === "1") {
        const initialRuntimeState = await abortable(
          this.observeRuntime(args.handler, "diagnostic", args.signal, {
            runId: conversationRecord.id,
            agentId: args.id,
          }),
          args.signal,
        );
        runtimeVerified = initialRuntimeState?.status === "running";
        const repairMessage = await runtimeRepairMessage(initialRuntimeState);
        if (repairMessage) {
          newMessage = [{ text: args.message }, { text: repairMessage }];
        } else if (initialRuntimeState?.status === "running") {
          newMessage = [
            { text: args.message },
            { text: formatRuntimeObservation(initialRuntimeState) },
          ];
        }
      }

      // Continue until no tools, repairs, plans, or delegated results remain.
      while (hasToolCall && runStatus === "RUNNING") {
        throwIfRunCancelled(args.signal);
        let modelResponse;
        hasToolCall = false;
        let withheldTurnText = "";

        try {
          console.log("\n\n\n------------------------------------");

          throwIfRunCancelled(args.signal);

          // Send the current user, tool, repair, or delegation message to Gemini.
          const session = GeminiProvider.sessions[this.sessionKey]!;
          // Tool calls must arrive atomically. Gemini's streaming response can
          // expose growing argument snapshots that are not safe to execute.
          modelResponse = await session.chat.sendMessage({
            message: newMessage,
            // A per-request config does not inherit the chat config in
            // @google/genai. Repeat the system/tool configuration here so
            // adding an abort signal does not silently remove every tool.
            config: createGeminiGenerationConfig({
              systemInstruction: session.systemInstruction,
              functionDeclarations: this.functionDeclarations(),
              abortSignal: args.signal,
              forceWorkspaceMutation,
            }),
          });
          forceWorkspaceMutation = false;
        } catch (error: any) {
          if (args.signal?.aborted) throw new AgentRunCancelledError();
          console.log(args.id, " - ", error);
          const errorMessage =
            error.status === 429
              ? "Limit reached, try after a minute"
              : `Error: ${error.message || JSON.stringify(error)}`;
          runStatus = "FAILED";
          runError = errorMessage;
          args.handler.onChunk?.({ type: "error", response: errorMessage });
          break;
        }

        withheldTurnText = modelResponse.text ?? "";
        let functionCallResponses: PartListUnion = [];
        for (const functionCall of modelResponse.functionCalls ?? []) {
          throwIfRunCancelled(args.signal);

          const toolName = functionCall.name ?? "unknownTool";
          const functionArgs = functionCall.args as
            Record<string, unknown> | undefined;
          const toolActivityId = `${args.id}-${++toolActivitySequence}`;

          const tool = getTool(toolName);

          emitToolActivity(
            toolActivityId,
            tool,
            functionArgs,
            "started",
            args.handler.onChunk,
          );

          try {
            if (!tool) {
              emitToolActivity(
                toolActivityId,
                tool,
                functionArgs,
                "failed",
                args.handler.onChunk,
              );
              functionCallResponses.push({
                functionResponse: {
                  ...(functionCall.id && { id: functionCall.id }),
                  name: toolName,
                  response: {
                    output: "No such tool exist",
                  },
                },
              });
              continue;
            }

            const toolArgs = {
              args: {
                ...(functionCall.args as any),
              },
              context: {
                cwd: this.cwd,
                databaseProjectId: this.projectId,
                agentRunId: String(conversationRecord.id),
                signal: args.signal,
              },
            };

            const output = await abortable(
              Promise.resolve(tool.executable(toolArgs.args, toolArgs.context)),
              args.signal,
            );

            if (output.effects?.workspaceChanged) {
              workspaceChanged = true;
            }

            if (tool.declaration.name === "createSubAgent") {
              const provisionOutput = output as {
                response: string;
                workspacePath?: string;
              };
              if (provisionOutput.workspacePath) {
                const subAgentId = functionCall.args?.id as string;
                const subAgentSession = new GeminiProvider(
                  this.projectId,
                  this.frontendLibrary,
                  functionCall.args?.systemPrompt as string,
                  provisionOutput.workspacePath,
                  `${this.sessionKey}:agent:${subAgentId}`,
                );
                startSubAgentLifecycle({
                  id: subAgentId,
                  projectId: this.projectId,
                  parentRunId: String(conversationRecord.id),
                  parentAgentId: args.id,
                  mainWorktreePath: this.cwd || process.cwd(),
                  start: () =>
                    subAgentSession.agentLoop({
                      id: subAgentId,
                      message: functionCall.args?.prompt as string,
                      signal: args.signal,
                      handler: { onChunk: args.handler.onChunk },
                    }),
                  onSettled: (result) => {
                    args.handler.onChunk?.({
                      type:
                        result.status === "MERGED"
                          ? "subAgentFinished"
                          : "subAgentFailed",
                      response: result,
                    });
                  },
                });
              }
            }

            applyTaskPlanToolCall({
              toolName: tool.declaration.name ?? "",
              toolArgs: functionArgs,
              output,
              activeTaskPlan,
              completedTaskIds,
            });

            if (output.yield) {
              args.handler.onChunk?.({
                type: output.yield.type,
                response: output.yield.response,
                uuid: output.yield.uuid,
              });

              if (output.yield?.resolver)
                try {
                  output.response = await abortable(
                    output.yield.resolver,
                    args.signal,
                  );
                } finally {
                  if (output.yield.uuid) {
                    removeInputRequest(output.yield.uuid);
                  }
                }
            }

            await prisma.conversationHistory.create({
              data: {
                contents: JSON.stringify(toolArgs),
                from: "ASSISTANT",
                toolCall: tool.declaration.name,
                projectId: this.projectId,
                type: "TOOL_CALL",
                output: serializeAuditPayload({
                  response: output.response,
                  yield: output.yield
                    ? {
                        type: output.yield.type,
                        response: output.yield.response,
                        uuid: output.yield.uuid,
                      }
                    : undefined,
                  effects: output.effects,
                }),
                agentId: args.id,
              },
            });

            functionCallResponses.push({
              functionResponse: {
                ...(functionCall.id && { id: functionCall.id }),
                name: functionCall.name,
                response: {
                  output: output.response,
                },
              },
            });
            emitToolActivity(
              toolActivityId,
              tool,
              functionArgs,
              "completed",
              args.handler.onChunk,
            );
          } catch (error: any) {
            if (error instanceof AgentRunCancelledError) throw error;
            const toolError =
              error instanceof Error ? error.message : JSON.stringify(error);
            await prisma.conversationHistory.create({
              data: {
                contents: JSON.stringify({
                  args: functionArgs,
                  context: {
                    cwd: this.cwd,
                    databaseProjectId: this.projectId,
                    agentRunId: String(conversationRecord.id),
                  },
                }),
                from: "ASSISTANT",
                toolCall: toolName,
                projectId: this.projectId,
                type: "TOOL_CALL",
                output: serializeAuditPayload({ error: toolError }),
                errorMessage: toolError,
                agentId: args.id,
              },
            });
            emitToolActivity(
              toolActivityId,
              tool,
              functionArgs,
              "failed",
              args.handler.onChunk,
            );
            functionCallResponses.push({
              functionResponse: {
                ...(functionCall.id && { id: functionCall.id }),
                name: toolName,
                response: {
                  output: toolError,
                },
              },
            });
          }

          hasToolCall = true;
        }

        if (hasToolCall) newMessage = functionCallResponses;

        throwIfRunCancelled(args.signal);

        // Surface already-settled delegated work without blocking the main agent.
        const readySubAgentResults = await subAgentRegistry.collectRun(
          {
            projectId: this.projectId,
            parentRunId: String(conversationRecord.id),
          },
          "ready",
        );
        if (readySubAgentResults.length > 0) {
          const mergedWorkspace =
            delegatedResultsChangedWorkspace(readySubAgentResults);
          workspaceChanged ||= mergedWorkspace;
          newMessage = [
            ...newMessage,
            {
              text: delegatedResultsMessage(readySubAgentResults, false),
            },
          ];
          hasToolCall = true;
        }

        // Confirm net filesystem changes instead of trusting tool declarations.
        if (!hasToolCall && args.id === "1" && initialWorkspaceFingerprint) {
          const currentWorkspaceFingerprint = await abortable(
            fingerprintWorkspace(this.cwd),
            args.signal,
          );
          workspaceChanged =
            currentWorkspaceFingerprint !== initialWorkspaceFingerprint;
        }

        // Resolve unfinished plan steps before collecting delegated work.
        if (
          !hasToolCall &&
          activeTaskPlan.size > 0 &&
          completedTaskIds.size < activeTaskPlan.size
        ) {
          const remaining = [...activeTaskPlan.keys()].filter(
            (id) => !completedTaskIds.has(id),
          );
          newMessage = [
            ...newMessage,
            {
              text: `You still have ${remaining.length} unfinished task(s) from your plan (${remaining.join(", ")}). Continue working on them, or call informCompletedTaskFromTaskPlan / explain why they can't be completed.`,
            },
          ];
          hasToolCall = true;
        }

        // Automatically join every remaining delegate at the completion boundary.
        if (!hasToolCall) {
          const subAgentResults = await abortable(
            subAgentRegistry.collectRun(
              {
                projectId: this.projectId,
                parentRunId: String(conversationRecord.id),
              },
              "all",
            ),
            args.signal,
          );
          if (subAgentResults.length > 0) {
            const mergedWorkspace =
              delegatedResultsChangedWorkspace(subAgentResults);
            workspaceChanged ||= mergedWorkspace;
            newMessage = [
              {
                text: delegatedResultsMessage(subAgentResults, true),
              },
            ];
            hasToolCall = true;
          }
        }

        // AUTO is the fast path. Classify only a terminal no-change response,
        // then force a mutation tool on the next turn when confidence is high.
        if (
          !hasToolCall &&
          args.id === "1" &&
          !workspaceChanged &&
          requestIntent === undefined
        ) {
          requestIntent = await abortable(
            GeminiProvider.classifyRequestIntent(args.message, args.signal),
            args.signal,
          );
          await this.persistRunEvent({
            runId: conversationRecord.id,
            agentId: args.id,
            event: "intentClassification",
            payload: requestIntent,
          });
        }

        const mutationRequired =
          requestIntent?.intent === "implementation" &&
          requestIntent.confidence >= IMPLEMENTATION_CONFIDENCE_THRESHOLD;
        if (!hasToolCall && mutationRequired && !workspaceChanged) {
          withheldTurnText = "";
          if (noMutationRetries >= MAX_NO_MUTATION_RETRIES) {
            runStatus = "FAILED";
            runError =
              "The coding agent did not modify the frontend workspace after two enforced retries.";
            args.handler.onChunk?.({ type: "error", response: runError });
          } else {
            noMutationRetries += 1;
            forceWorkspaceMutation = true;
            newMessage = [
              {
                text: "This implementation response was rejected because no workspace change succeeded. Use a workspace mutation tool now, make the requested frontend change, and verify it before completing. Do not answer with a plan or tutorial.",
              },
            ];
            hasToolCall = true;
            await this.persistRunEvent({
              runId: conversationRecord.id,
              agentId: args.id,
              event: "mutationEnforcement",
              payload: {
                retry: noMutationRetries,
                intent: requestIntent,
              },
            });
          }
        }

        if (runStatus !== "RUNNING") break;

        // Every main request must finish against a healthy application. Changed
        // workspaces additionally pass the visual-quality completion review.
        if (!hasToolCall && args.id === "1") {
          const runtimeState = await abortable(
            this.observeRuntime(
              args.handler,
              workspaceChanged ? "completion" : "functional",
              args.signal,
              {
                runId: conversationRecord.id,
                agentId: args.id,
              },
            ),
            args.signal,
          );
          runtimeVerified = runtimeState?.status === "running";

          const repairMessage = await runtimeRepairMessage(runtimeState);
          if (repairMessage) {
            newMessage = [{ text: repairMessage }];
            hasToolCall = true;
          }
        }

        if (runStatus !== "RUNNING") break;

        if (!hasToolCall && !withheldTurnText.trim()) {
          const fallbackMessage = workspaceChanged
            ? completionFallbackMessage(runtimeVerified)
            : runtimeVerified
              ? "I found no reproducible application failure. Strict lint, the production build, and the live browser preview are healthy."
              : "I could not complete a reliable application diagnosis.";
          args.handler.onChunk?.({
            type: "message",
            response: fallbackMessage,
          });
          rawFinalOutput += `${rawFinalOutput ? "\n\n" : ""}${fallbackMessage}`;
          finalOutput += `${finalOutput ? "\n\n" : ""}${fallbackMessage}`;
        } else if (!hasToolCall) {
          const rawMessage = withheldTurnText.trim();
          const finalMessage =
            workspaceChanged
              ? await abortable(
                  GeminiProvider.rewriteCompletionMessageAgent({
                    userRequest: args.message,
                    draft: withheldTurnText,
                    workspaceChanged,
                    runtimeVerified,
                  }),
                  args.signal,
                )
              : withheldTurnText;
          args.handler.onChunk?.({
            type: "message",
            response: finalMessage,
          });
          rawFinalOutput += `${rawFinalOutput ? "\n\n" : ""}${rawMessage}`;
          finalOutput += `${finalOutput ? "\n\n" : ""}${finalMessage.trim()}`;
        }
      }

      const history =
        GeminiProvider.sessions[this.sessionKey]!.chat.getHistory();

      // Sub-agents persist their own terminal record and return to the merger.
      if (args.id !== "1") {
        if (runStatus === "RUNNING") runStatus = "SUCCEEDED";
        await prisma.conversationHistory.update({
          where: { id: conversationRecord.id },
          data: {
            status: runStatus,
            completed: true,
            output:
              runStatus === "SUCCEEDED" ? finalOutput.trim() || null : null,
            rawOutput:
              runStatus === "SUCCEEDED" ? rawFinalOutput || null : null,
            errorMessage: runError,
          },
        });
        return {
          history,
          id: args.id,
          status: runStatus,
          summary: finalOutput.trim() || runError || "",
        };
      }

      if (runStatus === "RUNNING") runStatus = "SUCCEEDED";

      // Save both the polished UI response and untouched Gemini completion.
      await prisma.conversationHistory.update({
        where: {
          id: conversationRecord.id,
        },
        data: {
          status: runStatus,
          completed: true,
          output: runStatus === "SUCCEEDED" ? finalOutput.trim() || null : null,
          rawOutput: runStatus === "SUCCEEDED" ? rawFinalOutput || null : null,
          errorMessage: runError,
        },
      });

      // Compact long successful histories without changing the completed run.
      if (history.length > 0) {
        try {
          const sessionTokens =
            await GeminiProvider.geminiClient.models.countTokens({
              model: implementationModel,
              contents: history,
            });

          // Compact only after the run. Rewriting function-call arguments in
          // the middle of a tool-response chain can make Gemini repeat a call.
          if (
            (sessionTokens?.totalTokens ?? 0) >
            CONTEXT_COMPACTION_TOKEN_THRESHOLD
          ) {
            const { contextedCount, history: newHistory } =
              GeminiProvider.contextualiseChat(
                history,
                this.sessionKey,
                this.projectId,
              );
            const session = GeminiProvider.sessions[this.sessionKey]!;
            if (contextedCount >= 3) {
              const sessionSummary = await GeminiProvider.summariseChat(
                newHistory,
                session.persistentSummary,
              );

              await prisma.agentMemory.upsert({
                where: { projectId: this.projectId },
                create: {
                  projectId: this.projectId,
                  summary: sessionSummary,
                  summarizedThroughHistoryId: conversationRecord.id,
                },
                update: {
                  summary: sessionSummary,
                  summarizedThroughHistoryId: conversationRecord.id,
                },
              });

              GeminiProvider.sessions[this.sessionKey] = {
                ...this.createNewSession({
                  newSystemPrompt: sessionSummary,
                }),
                contextualiseCount: 0,
                persistentSummary: sessionSummary,
                summarizedThroughHistoryId: conversationRecord.id,
              };
            } else {
              GeminiProvider.sessions[this.sessionKey] = {
                ...this.createNewSession({
                  newSystemPrompt: session.persistentSummary,
                  history: newHistory,
                }),
                contextualiseCount: contextedCount + 1,
                persistentSummary: session.persistentSummary,
                summarizedThroughHistoryId: session.summarizedThroughHistoryId,
              };
            }
          }

          const activeHistory =
            GeminiProvider.sessions[this.sessionKey]!.chat.getHistory();
          const sessionTokensAfter =
            await GeminiProvider.geminiClient.models.countTokens({
              model: implementationModel,
              contents: activeHistory,
            });

          console.log("SESSION TOKENS:", sessionTokensAfter.totalTokens);
        } catch (memoryError) {
          // The user-visible run has already succeeded and its raw turn is in
          // ConversationHistory. A failed optimization must not rewrite that
          // successful run as an agent failure.
          console.error(
            "Unable to compact persistent agent memory:",
            memoryError,
          );
        }
      }

      // GeminiProvider.sessions[this.projectId]!.chat = GeminiProvider.sessions[this.projectId]!.chat;

      args.handler.onFinish?.();
      return {
        history: history,
        id: args.id,
        status: runStatus,
        summary: finalOutput.trim() || runError || "",
      };
    } catch (error) {
      if (error instanceof AgentRunCancelledError) {
        const stoppedMessage = "Generation stopped by user.";
        runStatus = "CANCELLED";
        runError = stoppedMessage;
        if (conversationRecord) {
          await prisma.conversationHistory.update({
            where: { id: conversationRecord.id },
            data: {
              status: runStatus,
              completed: true,
              output: null,
              rawOutput: null,
              errorMessage: runError,
            },
          });
        }
        args.handler.onChunk?.({ type: "stopped", response: stoppedMessage });
        args.handler.onFinish?.();
        return {
          history:
            GeminiProvider.sessions[this.sessionKey]?.chat.getHistory() ?? [],
          id: args.id,
          status: runStatus,
          summary: stoppedMessage,
        };
      }
      console.log(error);
      if (conversationRecord) {
        const errorMessage =
          error instanceof Error ? error.message : "The agent run failed.";
        await prisma.conversationHistory.update({
          where: { id: conversationRecord.id },
          data: {
            status: "FAILED",
            completed: true,
            output: null,
            rawOutput: null,
            errorMessage,
          },
        });
      }
      throw error;
    } finally {
      if (conversationRecord) {
        subAgentRegistry.clearRun({
          projectId: this.projectId,
          parentRunId: String(conversationRecord.id),
        });
      }
    }
  }

  public async agentSync(args: { id: string; message: string }) {
    return this.agentLoop({
      message: args.message,
      id: args.id,
      handler: {},
    });
  }

  public async *agentStream(args: {
    id: string;
    message: string;
    signal?: AbortSignal;
  }): AsyncGenerator<AgentChunk> {
    let controller!: ReadableStreamDefaultController<AgentChunk>;
    const stream = new ReadableStream<AgentChunk>({
      start(value) {
        controller = value;
      },
    });

    void this.agentLoop({
      message: args.message,
      id: args.id,
      signal: args.signal,
      handler: {
        onChunk: (chunk) => controller.enqueue(chunk),
        onFinish: () => controller.close(),
      },
    }).catch((error) => controller.error(error));

    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Agent is done");
        return;
      }
      yield value;
    }
  }
}
