import { type FunctionDeclaration } from "@google/genai";
import { catchUserInputResolver } from "../helper";
import { randomUUID } from "node:crypto";
import { Tools } from "../types/tools";

export let inputTools = {
  takeUserInput: {
    identifier: Tools.TAKE_INPUT,
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
    executable: (args: { questions: object }, _context: { cwd: string }) => {
      let uuid = randomUUID();
      return {
        response: "",
        yield: {
          type: "askInput",
          response: args.questions,
          uuid: uuid,
          resolver: new Promise((resolve, rejects) => {
            catchUserInputResolver.set(uuid, (input: string) => resolve(input));
          }),
        },
      };
    },
  },
};
