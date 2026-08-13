import { describe, expect, test } from "bun:test";
import { taskTool } from "./task";

describe("task planning tool", () => {
  test("declares and yields an ordered array of plan steps", () => {
    const schema = taskTool.createTaskPlan.declaration
      .parametersJsonSchema as any;
    expect(schema.properties.taskList.type).toBe("array");
    expect(schema.properties.taskList.minItems).toBe(3);
    expect(schema.properties.taskList.maxItems).toBe(6);
    expect(schema.properties.taskList.items.required).toEqual(["id", "task"]);

    const taskList = [
      { id: "structure", task: "Create the page structure" },
      { id: "polish", task: "Add responsive styling and states" },
    ];
    expect(
      taskTool.createTaskPlan.executable({ taskList }, {
        cwd: "/workspace",
      }),
    ).toMatchObject({
      response: "continue",
      yield: { type: "plan", response: taskList },
    });
  });
});
