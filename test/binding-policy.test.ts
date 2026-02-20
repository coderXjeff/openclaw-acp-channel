import { describe, it, expect } from "vitest";
import { analyzeAcpBindings } from "../src/binding-policy.js";

describe("analyzeAcpBindings", () => {
  it("strict mode flags one-agent-many-accounts", () => {
    const cfg: any = {
      bindings: [
        { agentId: "work", match: { channel: "acp", accountId: "work" } },
        { agentId: "work", match: { channel: "acp", accountId: "personal" } },
      ],
    };
    const acp: any = {
      enabled: true,
      agentAidBindingMode: "strict",
      identities: {
        work: { agentName: "work-bot" },
        personal: { agentName: "personal-bot" },
      },
    };
    const result = analyzeAcpBindings(cfg, acp);
    expect(result.mode).toBe("strict");
    expect(result.issues.some((x) => x.level === "error")).toBe(true);
  });

  it("strict mode passes for 1:1 mapping", () => {
    const cfg: any = {
      bindings: [
        { agentId: "work", match: { channel: "acp", accountId: "work" } },
        { agentId: "personal", match: { channel: "acp", accountId: "personal" } },
      ],
    };
    const acp: any = {
      enabled: true,
      agentAidBindingMode: "strict",
      identities: {
        work: { agentName: "work-bot" },
        personal: { agentName: "personal-bot" },
      },
    };
    const result = analyzeAcpBindings(cfg, acp);
    expect(result.issues.filter((x) => x.level === "error")).toHaveLength(0);
  });

  it("flex mode downgrades naming mismatch to warn", () => {
    const cfg: any = {
      bindings: [{ agentId: "agent-work", match: { channel: "acp", accountId: "work" } }],
    };
    const acp: any = {
      enabled: true,
      agentAidBindingMode: "flex",
      identities: { work: { agentName: "work-bot" } },
    };
    const result = analyzeAcpBindings(cfg, acp);
    expect(result.issues.some((x) => x.level === "warn")).toBe(true);
    expect(result.issues.some((x) => x.level === "error")).toBe(false);
  });
});
