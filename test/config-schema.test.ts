import { describe, it, expect } from "vitest";
import { acpConfigSchema } from "../src/config-schema.js";
import { DEFAULT_SESSION_CONFIG } from "../src/types.js";

type SchemaNode = {
  properties?: Record<string, SchemaNode>;
  default?: unknown;
};

describe("acpConfigSchema defaults", () => {
  const schema = acpConfigSchema as SchemaNode;
  const session = schema.properties?.session as SchemaNode;
  const sessionProps = session?.properties ?? {};

  it("session defaults 与 DEFAULT_SESSION_CONFIG 一致", () => {
    expect(sessionProps.endMarkers?.default).toEqual(DEFAULT_SESSION_CONFIG.endMarkers);
    expect(sessionProps.consecutiveEmptyThreshold?.default).toBe(DEFAULT_SESSION_CONFIG.consecutiveEmptyThreshold);
    expect(sessionProps.sendEndMarkerOnClose?.default).toBe(DEFAULT_SESSION_CONFIG.sendEndMarkerOnClose);
    expect(sessionProps.sendAckOnReceiveEnd?.default).toBe(DEFAULT_SESSION_CONFIG.sendAckOnReceiveEnd);
    expect(sessionProps.maxTurns?.default).toBe(DEFAULT_SESSION_CONFIG.maxTurns);
    expect(sessionProps.maxDurationMs?.default).toBe(DEFAULT_SESSION_CONFIG.maxDurationMs);
    expect(sessionProps.idleTimeoutMs?.default).toBe(DEFAULT_SESSION_CONFIG.idleTimeoutMs);
    expect(sessionProps.maxConcurrentSessions?.default).toBe(DEFAULT_SESSION_CONFIG.maxConcurrentSessions);
  });

  it("maxConcurrentSessions 已在 schema 暴露", () => {
    expect(sessionProps.maxConcurrentSessions).toBeDefined();
  });

  it("agentName 非全局 required（仅 enabled 时需要）", () => {
    const required = (acpConfigSchema as any).required as string[] | undefined;
    expect(required ?? []).not.toContain("agentName");
  });
});

