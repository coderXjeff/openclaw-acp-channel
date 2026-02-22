import { describe, it, expect } from "vitest";
import { buildDmSessionKey, buildGroupSessionKey, normalizeAid, normalizeGroupId } from "../src/acp-session-key.js";

describe("normalizeAid", () => {
  it("converts to lowercase", () => {
    expect(normalizeAid("Alice.AgentCP.io")).toBe("alice.agentcp.io");
  });

  it("trims whitespace", () => {
    expect(normalizeAid("  bob.agentcp.io  ")).toBe("bob.agentcp.io");
  });
});

describe("normalizeGroupId", () => {
  it("converts to lowercase and trims", () => {
    expect(normalizeGroupId("  GRP-123  ")).toBe("grp-123");
  });
});

describe("buildDmSessionKey", () => {
  it("default identity omits identityId", () => {
    const key = buildDmSessionKey({ agentId: "main", identityId: "default", peerAid: "Alice.AgentCP.io" });
    expect(key).toBe("agent:main:acp:peer:alice.agentcp.io");
  });

  it("named identity includes identityId", () => {
    const key = buildDmSessionKey({ agentId: "main", identityId: "guard", peerAid: "Bob.AgentCP.io" });
    expect(key).toBe("agent:main:acp:guard:peer:bob.agentcp.io");
  });

  it("does not contain sessionId fragment", () => {
    const key = buildDmSessionKey({ agentId: "main", identityId: "default", peerAid: "test.agentcp.io" });
    expect(key).not.toMatch(/session/);
  });

  it("same peer always produces same key regardless of call time", () => {
    const k1 = buildDmSessionKey({ agentId: "main", identityId: "default", peerAid: "peer.agentcp.io" });
    const k2 = buildDmSessionKey({ agentId: "main", identityId: "default", peerAid: "peer.agentcp.io" });
    expect(k1).toBe(k2);
  });
});

describe("buildGroupSessionKey", () => {
  it("default identity omits identityId", () => {
    const key = buildGroupSessionKey({ agentId: "main", identityId: "default", groupId: "GRP-001" });
    expect(key).toBe("agent:main:acp:group:grp-001");
  });

  it("named identity includes identityId", () => {
    const key = buildGroupSessionKey({ agentId: "main", identityId: "seer", groupId: "GRP-002" });
    expect(key).toBe("agent:main:acp:seer:group:grp-002");
  });
});
