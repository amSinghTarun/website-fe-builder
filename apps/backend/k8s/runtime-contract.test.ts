import { describe, expect, test } from "bun:test";
import { getPvcSpec } from "./pvc";
import { agentDeploymentSpec } from "./services/agent/deployment";
import { agentServiceSpec } from "./services/agent/service";
import { recoveryDeploymentSpec } from "./services/recovery_cron/deployment";
import { workspaceDeploymentSpec } from "./services/workspace/deployment";
import { workspaceServiceSpec } from "./services/workspace/service";
import { wsServerDeploymentSpec } from "./services/wsServer/deployment";
import { wsServerServiceSpec } from "./services/wsServer/service";

const databaseProjectId = "database-id";
const runtimeId = `sky-${databaseProjectId}`;

describe("per-project runtime contract", () => {
  test("workspace command is valid shell and Vite uses port 5173", async () => {
    const deployment = workspaceDeploymentSpec("react", databaseProjectId);
    const container = deployment.spec.template.spec.containers[0]!;
    const shellCheck = Bun.spawnSync({
      cmd: ["sh", "-n", "-c", container.command[2]!],
    });

    expect(shellCheck.exitCode).toBe(0);
    expect(container.command[2]).toContain("/app/.sky-restore-ready");
    expect(container.command[2]).toContain(
      "[ ! -f /app/my-app/package.json ]",
    );
    expect(container.ports[0]?.containerPort).toBe(5173);
    expect(container.startupProbe.tcpSocket.port).toBe(5173);
    expect(container.readinessProbe.httpGet.port).toBe(5173);
    expect(container.env).toContainEqual({
      name: "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS",
      value: "project.tarun.co",
    });
    expect(container.resources.requests).toEqual({
      cpu: "250m",
      memory: "512Mi",
    });
    expect(deployment.spec.strategy).toEqual({ type: "Recreate" });
    expect(deployment.metadata.name).toBe(`${runtimeId}-workspace`);

    const service = workspaceServiceSpec(databaseProjectId);
    expect(service.metadata.name).toBe(`${runtimeId}-workspace-service`);
    expect(service.spec.ports[0]).toEqual({ port: 5173, targetPort: 5173 });
  });

  test("agent receives one project identity and derives runtime names", () => {
    const deployment = agentDeploymentSpec(databaseProjectId);
    const container = deployment.spec.template.spec.containers[0]!;
    const environment = Object.fromEntries(
      container.env
        .filter((entry) => "value" in entry)
        .map((entry) => [entry.name, entry.value]),
    );

    expect(environment).toMatchObject({
      DATABASE_PROJECT_ID: databaseProjectId,
      WORKSPACE_PATH: "/user-app/my-app",
      WORKSPACE_SERVICE: `${runtimeId}-workspace-service`,
      WORKSPACE_PORT: "5173",
      WORKSPACE_PUBLIC_HOST: "project.tarun.co",
      WORKSPACE_HEALTH_PATH: `/workspace/${runtimeId}/`,
      PORT: "3000",
    });
    expect(environment).not.toHaveProperty("RUNTIME_ID");
    expect(deployment.spec.template.spec.initContainers[0]?.command[2]).toContain(
      `${runtimeId}-workspace-service 5173`,
    );
    expect(container.readinessProbe.httpGet).toEqual({
      path: "/health",
      port: 3000,
    });
    expect(deployment.spec.strategy).toEqual({ type: "Recreate" });
    expect(container.resources.requests).toEqual({
      cpu: "250m",
      memory: "512Mi",
    });
    expect(deployment.spec.template.spec.initContainers[0]?.resources.requests)
      .toEqual({ cpu: "50m", memory: "64Mi" });

    const service = agentServiceSpec(databaseProjectId);
    expect(service.metadata.name).toBe(`${runtimeId}-agent-service`);
    expect(service.spec.ports[0]).toEqual({ port: 3000, targetPort: 3000 });
  });

  test("recovery receives one project identity and derives runtime names", () => {
    const deployment = recoveryDeploymentSpec(databaseProjectId);
    const container = deployment.spec.template.spec.containers[0]!;
    const environment = Object.fromEntries(
      container.env
        .filter((entry) => "value" in entry)
        .map((entry) => [entry.name, entry.value]),
    );

    expect(deployment.metadata.name).toBe(`${runtimeId}-recovery`);
    expect(deployment.spec.strategy).toEqual({ type: "Recreate" });
    expect(container.resources.requests).toEqual({
      cpu: "100m",
      memory: "256Mi",
    });
    expect(environment.DATABASE_PROJECT_ID).toBe(databaseProjectId);
    expect(environment).not.toHaveProperty("RUNTIME_ID");
  });

  test("every Kubernetes builder derives the runtime ID exactly once", () => {
    const pvc = getPvcSpec(databaseProjectId);
    const websocketDeployment = wsServerDeploymentSpec(databaseProjectId);
    const websocketService = wsServerServiceSpec(databaseProjectId);

    expect(pvc.metadata.name).toBe(`${runtimeId}-pvc`);
    expect(websocketDeployment.metadata.name).toBe(
      `${runtimeId}-ws-server-deployment`,
    );
    expect(websocketService.metadata.name).toBe(
      `${runtimeId}-ws-server-service`,
    );

    for (const name of [
      pvc.metadata.name,
      websocketDeployment.metadata.name,
      websocketService.metadata.name,
    ]) {
      expect(name.startsWith("sky-sky-")).toBe(false);
    }
  });

  test("deployment names remain valid for database UUID project IDs", () => {
    const uuid = "b955da7b-8f9e-4324-af2a-123456789abc";
    const deploymentNames = [
      workspaceDeploymentSpec("react", uuid).metadata.name,
      recoveryDeploymentSpec(uuid).metadata.name,
      wsServerDeploymentSpec(uuid).metadata.name,
      agentDeploymentSpec(uuid).metadata.name,
    ];

    for (const name of deploymentNames) {
      expect(name.length).toBeLessThanOrEqual(63);
      expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    }
  });
});
