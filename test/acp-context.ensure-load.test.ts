import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  ensureIdentityContext,
  ensurePeerContext,
  ensureGroupContext,
  loadContextForDM,
  loadContextForGroup,
} from "../src/acp-context.js";
import { peerDir, groupDir } from "../src/context-paths.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-ctx-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensurePeerContext", () => {
  it("creates PEER.md and MEMORY.md", () => {
    ensurePeerContext(tmpDir, "default", "alice.agentcp.io");
    const pDir = path.join(tmpDir, "acp/identities/default/peers/alice.agentcp.io");
    expect(fs.existsSync(path.join(pDir, "PEER.md"))).toBe(true);
    expect(fs.existsSync(path.join(pDir, "MEMORY.md"))).toBe(true);
  });

  it("is idempotent — does not overwrite existing files", () => {
    ensurePeerContext(tmpDir, "default", "bob.agentcp.io");
    const peerMd = path.join(tmpDir, "acp/identities/default/peers/bob.agentcp.io/PEER.md");
    fs.writeFileSync(peerMd, "custom content");
    ensurePeerContext(tmpDir, "default", "bob.agentcp.io");
    expect(fs.readFileSync(peerMd, "utf-8")).toBe("custom content");
  });

  it("normalizes AID to lowercase", () => {
    ensurePeerContext(tmpDir, "default", "Alice.AgentCP.IO");
    const pDir = path.join(tmpDir, "acp/identities/default/peers/alice.agentcp.io");
    expect(fs.existsSync(pDir)).toBe(true);
  });
});

describe("ensureGroupContext", () => {
  it("creates GROUP.md, MY_ROLE.md, and MEMORY.md", () => {
    ensureGroupContext(tmpDir, "guard", "grp-001", "Test Group");
    const gDir = path.join(tmpDir, "acp/identities/guard/groups/grp-001");
    expect(fs.existsSync(path.join(gDir, "GROUP.md"))).toBe(true);
    expect(fs.existsSync(path.join(gDir, "MY_ROLE.md"))).toBe(true);
    expect(fs.existsSync(path.join(gDir, "MEMORY.md"))).toBe(true);
  });
});

describe("ensureIdentityContext", () => {
  it("creates IDENTITY.md and MEMORY.md", () => {
    ensureIdentityContext(tmpDir, "default", "mybot.agentcp.io");
    const iDir = path.join(tmpDir, "acp/identities/default");
    expect(fs.existsSync(path.join(iDir, "IDENTITY.md"))).toBe(true);
    expect(fs.existsSync(path.join(iDir, "MEMORY.md"))).toBe(true);
  });
});

describe("loadContextForDM", () => {
  it("loads identity + peer context in order", () => {
    ensureIdentityContext(tmpDir, "default", "mybot.agentcp.io");
    ensurePeerContext(tmpDir, "default", "alice.agentcp.io");
    const ctx = loadContextForDM({ workspaceDir: tmpDir, identityId: "default", peerAid: "alice.agentcp.io" });
    expect(ctx).toContain("Identity: default");
    expect(ctx).toContain("Peer Profile: alice.agentcp.io");
    // identity comes before peer
    expect(ctx.indexOf("Identity:")).toBeLessThan(ctx.indexOf("Peer Profile:"));
  });

  it("returns empty string when no files exist", () => {
    const ctx = loadContextForDM({ workspaceDir: tmpDir, identityId: "default", peerAid: "nobody.agentcp.io" });
    expect(ctx).toBe("");
  });

  it("respects tokenBudget", () => {
    ensureIdentityContext(tmpDir, "default", "mybot.agentcp.io");
    ensurePeerContext(tmpDir, "default", "alice.agentcp.io");
    const ctx = loadContextForDM({ workspaceDir: tmpDir, identityId: "default", peerAid: "alice.agentcp.io", tokenBudget: 50 });
    expect(ctx.length).toBeLessThanOrEqual(50);
  });
});

describe("loadContextForGroup", () => {
  it("loads identity + group context in order", () => {
    ensureIdentityContext(tmpDir, "guard", "guard.agentcp.io");
    ensureGroupContext(tmpDir, "guard", "grp-001");
    const ctx = loadContextForGroup({ workspaceDir: tmpDir, identityId: "guard", groupId: "grp-001" });
    expect(ctx).toContain("Identity: guard");
    expect(ctx).toContain("My Role: grp-001");
    expect(ctx).toContain("Group Profile: grp-001");
    // identity before group
    expect(ctx.indexOf("Identity:")).toBeLessThan(ctx.indexOf("Group Profile:"));
  });
});

describe("path traversal protection", () => {
  it("rejects peer AID with path traversal", () => {
    expect(() => peerDir(tmpDir, "default", "../../etc")).toThrow("Invalid AID");
  });

  it("rejects group ID with path traversal", () => {
    expect(() => groupDir(tmpDir, "default", "../../../tmp")).toThrow("Invalid groupId");
  });

  it("rejects peer AID with slashes", () => {
    expect(() => peerDir(tmpDir, "default", "foo/bar")).toThrow("Invalid AID");
  });

  it("rejects peer AID with null bytes", () => {
    expect(() => peerDir(tmpDir, "default", "foo\0bar")).toThrow("Invalid AID");
  });
});
