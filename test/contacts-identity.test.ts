import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("getContactManager identity isolation", () => {
  let homeDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    vi.resetModules();
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-home-test-"));
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    try {
      fs.rmSync(homeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("stores contacts per identity file", async () => {
    const { getContactManager } = await import("../src/contacts.js");
    const now = Date.now();

    getContactManager("work").add({
      aid: "alice.agentcp.io",
      groups: [],
      interactionCount: 0,
      totalDurationMs: 0,
      addedAt: now,
      updatedAt: now,
      creditScore: 50,
      successfulSessions: 0,
      failedSessions: 0,
    });
    getContactManager("personal").add({
      aid: "bob.agentcp.io",
      groups: [],
      interactionCount: 0,
      totalDurationMs: 0,
      addedAt: now,
      updatedAt: now,
      creditScore: 50,
      successfulSessions: 0,
      failedSessions: 0,
    });

    expect(getContactManager("work").get("alice.agentcp.io")).not.toBeNull();
    expect(getContactManager("work").get("bob.agentcp.io")).toBeNull();
    expect(getContactManager("personal").get("bob.agentcp.io")).not.toBeNull();

    const storageDir = path.join(homeDir, ".acp-storage");
    expect(fs.existsSync(path.join(storageDir, "contacts-work.json"))).toBe(true);
    expect(fs.existsSync(path.join(storageDir, "contacts-personal.json"))).toBe(true);
  });
});
