import { type FunctionDeclaration } from "@google/genai";
import { Tools } from "../types/tools";

export const taskTool = {
  createTaskPlan: {
    identifier: Tools.CREATE_PLAN,
    declaration: {
      name: "createTaskPlan",
      description:
        "Plan how to execute task, break it into smaller tasks and create a list of steps to complete the task given given by user",
      parametersJsonSchema: {
        type: "object",
        properties: {
          taskList: {
            type: "OBJECT",
            description:
              "object of the sub-task in which the main task has been broken into",
            properties: {
              id: {
                id: "STRING",
                description: "id of the task",
              },
              task: {
                id: "STRING",
                description: "the actaul subtask",
              },
            },
          },
        },
        required: ["taskList"],
      },
    } as FunctionDeclaration,
    executable: (args: { taskList: string[] }, _context: { cwd: string }) => {
      return {
        response: "continue",
        yield: { type: "plan", response: args.taskList },
      };
    },
  },
  informCompletedTaskFromTaskPlan: {
    identifier: Tools.INFORM_TASK_COMPLETION,
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
    executable: (args: { id: string }, _context: { cwd: string }) => {
      return {
        response: "DONE",
        yield: { type: "planComplete", response: args.id },
      };
    },
  },
};
