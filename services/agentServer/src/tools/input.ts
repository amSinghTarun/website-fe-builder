import { type FunctionDeclaration } from "@google/genai";
import { registerInputRequest } from "../inputRequestRegistry";
import { randomUUID } from "node:crypto";

export const inputTools = {
  takeUserInput: {
    activity: {
      started: "Preparing a question for you",
      completed: "Prepared a question for you",
    },
    declaration: {
      name: "takeUserInput",
      description:
        "Ask any task related doubt or guidance or question to user wherever you want their input or you have to decide on anything you think is relative to user",
      parametersJsonSchema: {
        type: "object",
        properties: {
          questions: {
            type: "ARRAY",
            description: "array of id and question maps",
            properties: {
              id: {
                type: "STRING",
                description: "Id of the question you want to ask to the user",
              },
              question: {
                type: "STRING",
                description: "The actual question you want to ask to the user",
              },
            },
          },
        },
        required: ["questions"],
      },
    } as FunctionDeclaration,
    executable: (args: { questions: object }) => {
      const uuid = randomUUID();
      return {
        response: "",
        yield: {
          type: "askInput",
          response: args.questions,
          uuid,
          resolver: new Promise((resolve) => {
            registerInputRequest(uuid, resolve);
          }),
        },
      };
    },
  },
};
