import { type FunctionDeclaration } from "@google/genai";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "fs";
import { resolveWorkspacePath } from "../helper";
import { Tools, type ToolContext, type ToolResult } from "../types/tools";
import { isContextArtifactReference } from "../context/contextArchive";

export let fileTools = {
  readDirectory: {
    identifier: Tools.READ_DIR,
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
    executable: (
      args: { directoryPath: string },
      context: ToolContext,
    ): ToolResult => {
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
    identifier: Tools.READ_FILE,
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
    executable: (
      args: { filePath: string },
      context: ToolContext,
    ): ToolResult => {
      const filePath = resolveWorkspacePath(context.cwd, args.filePath);
      const content = readFileSync(filePath, "utf-8");

      return {
        response: `Content of ${args.filePath} : \n ${content}`,
      };
    },
  },

  createFile: {
    identifier: Tools.CREATE_FILE,
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
      context: ToolContext,
    ): ToolResult => {
      const filePath = resolveWorkspacePath(context.cwd, args.fileCreatePath);

      writeFileSync(filePath, "", { flag: "wx" });

      return {
        response: `Created empty file at ${args.fileCreatePath}`,
        effects: { workspaceChanged: true, runtimeMayChange: true },
      };
    },
  },

  deleteFile: {
    identifier: Tools.DELETE_FILE,
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
      context: ToolContext,
    ): ToolResult => {
      const filePath = resolveWorkspacePath(context.cwd, args.fileDeletePath);

      unlinkSync(filePath);

      return {
        response: `Deleted ${args.fileDeletePath}`,
        effects: { workspaceChanged: true, runtimeMayChange: true },
      };
    },
  },

  updateFile: {
    identifier: Tools.UPDATE_FILE,
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
      context: ToolContext,
    ): ToolResult => {
      const filePath = resolveWorkspacePath(context.cwd, args.filePath);

      if (typeof args.content === "string") {
        if (isContextArtifactReference(args.content)) {
          return {
            response:
              "Error: refused to write a context-artifact reference into application source. Use readContextArtifact for historical content or readFileContent for the current file, then provide real source code.",
          };
        }

        writeFileSync(filePath, args.content, "utf-8");
        return {
          response: `Wrote ${args.content.length} characters to ${args.filePath}`,
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      }

      if (typeof args.oldString === "string") {
        if (!existsSync(filePath)) {
          return {
            response: `Error: cannot edit ${args.filePath} because it does not exist.`,
          };
        }

        const current = readFileSync(filePath, "utf-8");
        const occurrences = current.split(args.oldString).length - 1;

        if (occurrences === 0) {
          return {
            response: `Error: oldString was not found in ${args.filePath}. No changes made.`,
          };
        }

        if (occurrences > 1) {
          return {
            response: `Error: oldString matched ${occurrences} times in ${args.filePath}; it must be unique. No changes made.`,
          };
        }

        const replacement = args.newString ?? "";
        const updated = current.replace(args.oldString, () => replacement);

        writeFileSync(filePath, updated, "utf-8");

        return {
          response: `Replaced 1 occurrence in ${args.filePath}`,
          effects: { workspaceChanged: true, runtimeMayChange: true },
        };
      }

      return {
        response:
          'Error: provide either "content" (to overwrite) or "oldString"/"newString" (to replace).',
      };
    },
  },
};
