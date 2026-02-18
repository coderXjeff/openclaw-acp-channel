import { describe, it, expect, beforeEach } from "vitest";
import { createManageContactsTool } from "../src/tools.js";
import { getOrCreateRouter, resetRouter } from "../src/identity-router.js";

describe("acp_manage_contacts identity resolution", () => {
  beforeEach(() => {
    resetRouter();
  });

  it("requires self_aid", async () => {
    const tool = createManageContactsTool()();
    const result = await tool.execute("t1", { action: "list" } as any);
    const text = (result.content?.[0] as any)?.text ?? "";
    expect(text).toContain("self_aid is required");
  });

  it("rejects unknown self_aid", async () => {
    const router = getOrCreateRouter();
    router.registerIdentity("work", {
      accountId: "work",
      identityId: "work",
      agentName: "work-bot",
      domain: "agentcp.io",
      fullAid: "work-bot.agentcp.io",
      enabled: true,
      ownerAid: "",
      allowFrom: [],
      seedPassword: "",
    });

    const tool = createManageContactsTool()();
    const result = await tool.execute("t2", { action: "list", self_aid: "unknown.agentcp.io" } as any);
    const text = (result.content?.[0] as any)?.text ?? "";
    expect(text).toContain("cannot resolve identity");
  });
});
