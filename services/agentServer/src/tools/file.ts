import { type FunctionDeclaration } from "@google/genai";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "fs";
import { $Enums as prismaEnums } from "@sky/db";
import { resolveWorkspacePath } from "../helper";

export let fileTools = {
  readDirectory: {
    identifier: prismaEnums.ToolCall.READ_DIR,
    declaration: {
      name: "readDirectory",
      description: "List the files and folders in a directory.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          directoryPath: {
            type: "string",
            description:
              'Path to the directory, relative to the project root. Use "." for the root.',
          },
        },
        required: ["directoryPath"],
      },
    } as FunctionDeclaration,
    executable: (args: { directoryPath: string }, context: { cwd: string }) => {
      const directory = resolveWorkspacePath(context.cwd, args.directoryPath);

      const entries = readdirSync(directory, {
        recursive: true,
      });

      return {
        response: `Recursive list of Contents of ${args.directoryPath} : \n ${
          entries || "(empty)"
        }`,
      };
    },
  },

  readFileContent: {
    identifier: prismaEnums.ToolCall.READ_FILE,
    declaration: {
      name: "readFileContent",
      description: "Read and return the full text content of a file.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Path to the file, relative to the project root.",
          },
        },
        required: ["filePath"],
      },
    } as FunctionDeclaration,
    executable: (args: { filePath: string }, context: { cwd: string }) => {
      const filePath = resolveWorkspacePath(context.cwd, args.filePath);
      const content = readFileSync(filePath, "utf-8");

      return {
        response: `Content of ${args.filePath} : \n ${content}`,
      };
    },
  },

  createFile: {
    identifier: prismaEnums.ToolCall.CREATE_FILE,
    declaration: {
      name: "createFile",
      description:
        "Create a new, empty file. Fails if the file already exists. Use updateFile to write content into it.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          fileCreatePath: {
            type: "string",
            description: "Path for the new file, relative to the project root.",
          },
        },
        required: ["fileCreatePath"],
      },
    } as FunctionDeclaration,
    executable: (
      args: { fileCreatePath: string },
      context: { cwd: string },
    ) => {
      const filePath = resolveWorkspacePath(context.cwd, args.fileCreatePath);

      writeFileSync(filePath, "", { flag: "wx" });

      return {
        response: `Created empty file at ${args.fileCreatePath}`,
      };
    },
  },

  deleteFile: {
    identifier: prismaEnums.ToolCall.DELETE_FILE,
    declaration: {
      name: "deleteFile",
      description: "Delete the file at the specified path.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          fileDeletePath: {
            type: "string",
            description:
              "Path to the file to delete, relative to the project root.",
          },
        },
        required: ["fileDeletePath"],
      },
    } as FunctionDeclaration,
    executable: (
      args: { fileDeletePath: string },
      context: { cwd: string },
    ) => {
      const filePath = resolveWorkspacePath(context.cwd, args.fileDeletePath);

      unlinkSync(filePath);

      return {
        response: `Deleted ${args.fileDeletePath}`,
      };
    },
  },

  updateFile: {
    identifier: prismaEnums.ToolCall.UPDATE_FILE,
    declaration: {
      name: "updateFile",
      description:
        "Update a file's contents. Provide `content` to overwrite the whole file, OR `oldString` and `newString` to replace a specific snippet. When replacing, `oldString` must appear exactly once in the file.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Path to the file to update, relative to the project root.",
          },
          content: {
            type: "string",
            description:
              "New full contents of the file. Overwrites everything. Use this for new or fully-rewritten files.",
          },
          oldString: {
            type: "string",
            description:
              "Exact snippet to find and replace. Must match exactly once. Ignored if `content` is provided.",
          },
          newString: {
            type: "string",
            description: "Replacement text for `oldString`.",
          },
        },
        required: ["filePath"],
      },
    } as FunctionDeclaration,
    executable: (
      args: {
        filePath: string;
        content?: string;
        oldString?: string;
        newString?: string;
      },
      context: { cwd: string },
    ) => {
      const filePath = resolveWorkspacePath(context.cwd, args.filePath);

      if (typeof args.content === "string") {
        writeFileSync(filePath, args.content, "utf-8");
        return `Wrote ${args.content.length} characters to ${args.filePath}`;
      }

      if (typeof args.oldString === "string") {
        if (!existsSync(filePath)) {
          return `Error: cannot edit ${args.filePath} because it does not exist.`;
        }

        const current = readFileSync(filePath, "utf-8");
        const occurrences = current.split(args.oldString).length - 1;

        if (occurrences === 0) {
          return `Error: oldString was not found in ${args.filePath}. No changes made.`;
        }

        if (occurrences > 1) {
          return `Error: oldString matched ${occurrences} times in ${args.filePath}; it must be unique. No changes made.`;
        }

        const replacement = args.newString ?? "";
        const updated = current.replace(args.oldString, () => replacement);

        writeFileSync(filePath, updated, "utf-8");

        return `Replaced 1 occurrence in ${args.filePath}`;
      }

      return {
        response:
          'Error: provide either "content" (to overwrite) or "oldString"/"newString" (to replace).',
      };
    },
  },
};
