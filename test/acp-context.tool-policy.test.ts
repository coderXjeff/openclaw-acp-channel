import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  READ_ACTIONS,
  WRITE_ACTIONS,
  SEARCH_ACTIONS,
  PEER_SECTION_WHITELIST,
  GROUP_SECTION_WHITELIST,
  RATE_LIMITS,
} from "../src/context-schemas.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-tool-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("context-schemas", () => {
  it("READ_ACTIONS contains expected actions", () => {
    expect(READ_ACTIONS.has("read_peer")).toBe(true);
    expect(READ_ACTIONS.has("read_peer_memory")).toBe(true);
    expect(READ_ACTIONS.has("read_group")).toBe(true);
    expect(READ_ACTIONS.has("read_group_role")).toBe(true);
    expect(READ_ACTIONS.has("read_group_memory")).toBe(true);
    expect(READ_ACTIONS.has("read_identity_memory")).toBe(true);
    expect(READ_ACTIONS.has("read_global_memory")).toBe(true);
  });

  it("WRITE_ACTIONS contains expected actions", () => {
    expect(WRITE_ACTIONS.has("update_peer")).toBe(true);
    expect(WRITE_ACTIONS.has("update_group")).toBe(true);
    expect(WRITE_ACTIONS.has("append_memory")).toBe(true);
    expect(WRITE_ACTIONS.has("promote_memory")).toBe(true);
  });

  it("SEARCH_ACTIONS contains search_memory", () => {
    expect(SEARCH_ACTIONS.has("search_memory")).toBe(true);
  });

  it("section whitelists are defined", () => {
    expect(PEER_SECTION_WHITELIST.has("Notes")).toBe(true);
    expect(PEER_SECTION_WHITELIST.has("Preferences")).toBe(true);
    expect(GROUP_SECTION_WHITELIST.has("Purpose")).toBe(true);
    expect(GROUP_SECTION_WHITELIST.has("Rules")).toBe(true);
  });

  it("rate limits are reasonable", () => {
    expect(RATE_LIMITS.maxOpsPerTurn).toBe(3);
    expect(RATE_LIMITS.maxOpsPerMinute).toBe(10);
    expect(RATE_LIMITS.maxContentBytes).toBe(2048);
  });
});

describe("context-tool session context", () => {
  it("setSessionContext / clearSessionContext manage map", async () => {
    const { setSessionContext, clearSessionContext } = await import("../src/context-tool.js");
    const key = "test:123";
    setSessionContext(key, { chatType: "direct", isOwner: true });
    // clearSessionContext should not throw
    clearSessionContext(key);
    // clearing again should be safe
    clearSessionContext(key);
  });

  it("setActiveTurnKey / clearActiveTurnKey manage map", async () => {
    const { setActiveTurnKey, clearActiveTurnKey } = await import("../src/context-tool.js");
    setActiveTurnKey("default", "turn:1");
    clearActiveTurnKey("default");
    clearActiveTurnKey("default"); // safe to call twice
  });

  it("resetTurnOps resets per-turn counter", async () => {
    const { resetTurnOps } = await import("../src/context-tool.js");
    // Should not throw even if no state exists
    resetTurnOps("nonexistent");
  });
});
