import { describe, expect, test } from "bun:test";
import { toRuntimeId } from "@sky/common";
import { agentDeploymentSpec } from "./deployment";

describe("agentDeploymentSpec", () => {
  test("runs recovery cron as a startup-gated sidecar beside the agent", () => {
    const projectId = "318ae466-c11b-492b-aa9e-75896bede59e";
    const runtimeId = toRuntimeId(projectId);
    const deployment = agentDeploymentSpec(projectId);
    const podSpec = deployment.spec.template.spec;

    expect(podSpec.initContainers.map((container) => container.name)).toEqual([
      `${runtimeId}-recovery-cron`,
      "wait-for-workspace",
    ]);

    const recovery = podSpec.initContainers[0]!;
    expect(recovery.restartPolicy).toBe("Always");
    expect(recovery.startupProbe?.exec.command.join(" ")).toContain(
      "/user-app/.sky-restore-ready",
    );
    expect(recovery.volumeMounts).toContainEqual({
      name: `${runtimeId}-volume`,
      mountPath: "/user-app",
    });

    const agent = podSpec.containers[0]!;
    expect(agent.name).toBe(`${runtimeId}-agent`);
    expect(agent.volumeMounts).toContainEqual({
      name: `${runtimeId}-volume`,
      mountPath: "/user-app",
    });
    expect(podSpec.volumes[0]?.persistentVolumeClaim.claimName).toBe(
      `${runtimeId}-pvc`,
    );
  });
});
