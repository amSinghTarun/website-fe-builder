import { type FunctionDeclaration } from "@google/genai";

export const taskTool = {
  createTaskPlan: {
    activity: {
      started: "Planning the implementation steps",
      completed: "Planned the implementation steps",
    },
    declaration: {
      name: "createTaskPlan",
      description:
        "Plan how to execute task, break it into smaller tasks and create a list of steps to complete the task given given by user",
      parametersJsonSchema: {
        type: "object",
        properties: {
          taskList: {
            type: "array",
            description:
              "Three to six outcome-oriented implementation steps in execution order.",
            minItems: 3,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Stable short identifier for the step.",
                },
                task: {
                  type: "string",
                  description: "Concrete implementation outcome for the step.",
                },
              },
              required: ["id", "task"],
            },
          },
        },
        required: ["taskList"],
      },
    } as FunctionDeclaration,
    executable: (args: {
      taskList: Array<{ id: string; task: string }>;
    }) => ({
      response: "continue",
      yield: { type: "plan", response: args.taskList },
    }),
  },
  addTasksToPlan: {
    activity: {
      started: "Adding newly discovered implementation steps",
      completed: "Added newly discovered implementation steps",
    },
    declaration: {
      name: "addTasksToPlan",
      description:
        "Append newly discovered, non-duplicate steps to the task plan already created for this request. Do not repeat existing task IDs.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          taskList: {
            type: "array",
            description:
              "One or more additional outcome-oriented implementation steps in execution order.",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "A new stable short identifier for the step.",
                },
                task: {
                  type: "string",
                  description: "Concrete implementation outcome for the step.",
                },
              },
              required: ["id", "task"],
            },
          },
        },
        required: ["taskList"],
      },
    } as FunctionDeclaration,
    executable: (args: {
      taskList: Array<{ id: string; task: string }>;
    }) => ({
      response: "continue",
      yield: { type: "planAppend", response: args.taskList },
    }),
  },
  informCompletedTaskFromTaskPlan: {
    activity: {
      started: "Finishing an implementation step",
      completed: "Finished an implementation step",
    },
    declaration: {
      name: "informCompletedTaskFromTaskPlan",
      description:
        "call this tool to notify user of the task you accomplished in the task list you provided in createTaskPlan",
      parametersJsonSchema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "id of the task from the task list you accomplished",
          },
        },
        required: ["id"],
      },
    } as FunctionDeclaration,
    executable: (args: { id: string }) => ({
      response: "DONE",
      yield: { type: "planComplete", response: args.id },
    }),
  },
};
