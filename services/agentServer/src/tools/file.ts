import { type FunctionDeclaration } from "@google/genai";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "fs";
import path from "node:path";
import { type ToolContext, type ToolResult } from "../types/tools";
import { isContextArtifactReference } from "../context/contextArchive";
import { activityTarget } from "../toolActivity";

function resolveWorkspacePath(cwd: string, relativePath: string): string {
  const workspace = path.resolve(cwd);
  const resolved = path.resolve(workspace, relativePath);

  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error("Path escapes workspace");
  }

  return resolved;
}

export const fileTools = {
  readDirectory: {
    activity: {
      started: (args: { directoryPath: string }) =>
        `Inspecting project files ${activityTarget(args.directoryPath, ".")}`,
      completed: (args: { directoryPath: string }) =>
        `Inspected project files ${activityTarget(args.directoryPath, ".")}`,
    },
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
    activity: {
      started: (args: { filePath: string }) =>
        `Reading ${activityTarget(args.filePath, "a project file")}`,
      completed: (args: { filePath: string }) =>
        `Reviewed ${activityTarget(args.filePath, "a project file")}`,
    },
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
    activity: {
      started: (args: { fileCreatePath: string }) =>
        `Creating ${activityTarget(args.fileCreatePath, "a frontend file")}`,
      completed: (args: { fileCreatePath: string }) =>
        `Created ${activityTarget(args.fileCreatePath, "a frontend file")}`,
    },
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
    activity: {
      started: (args: { fileDeletePath: string }) =>
        `Removing ${activityTarget(args.fileDeletePath, "a frontend file")}`,
      completed: (args: { fileDeletePath: string }) =>
        `Removed ${activityTarget(args.fileDeletePath, "a frontend file")}`,
    },
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
    activity: {
      started: (args: { filePath: string }) =>
        `Updating ${activityTarget(args.filePath, "a frontend file")}`,
      completed: (args: { filePath: string }) =>
        `Updated ${activityTarget(args.filePath, "a frontend file")}`,
    },
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
