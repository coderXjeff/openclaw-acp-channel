import { describe, it, expect } from "vitest";
import { acpChannelPlugin } from "../src/channel.js";

describe("acp config adapter", () => {
  const adapter = acpChannelPlugin.config;

  it("listAccountIds returns identities keys in multi-identity mode", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          identities: {
            work: { agentName: "work-bot", domain: "agentcp.io" },
            personal: { agentName: "home-bot", domain: "agentcp.io" },
          },
        },
      },
    };
    expect(adapter.listAccountIds(cfg)).toEqual(["work", "personal"]);
  });

  it("resolveAccount reads selected identity fields", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          identities: {
            work: {
              agentName: "work-bot",
              domain: "agentcp.io",
              ownerAid: "owner.agentcp.io",
              allowFrom: ["*"],
              seedPassword: "seed-work",
            },
          },
        },
      },
    };
    const account = adapter.resolveAccount(cfg, "work");
    expect(account).not.toBeNull();
    if (!account) return;
    expect(account.accountId).toBe("work");
    expect(account.identityId).toBe("work");
    expect(account.fullAid).toBe("work-bot.agentcp.io");
    expect(account.ownerAid).toBe("owner.agentcp.io");
    expect(account.allowFrom).toEqual(["*"]);
    expect(account.seedPassword).toBe("seed-work");
  });

  it("resolveAccount falls back to default in legacy mode", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          agentName: "legacy-bot",
          domain: "agentcp.io",
        },
      },
    };
    const account = adapter.resolveAccount(cfg, "default");
    expect(account).not.toBeNull();
    if (!account) return;
    expect(account.accountId).toBe("default");
    expect(account.identityId).toBe("default");
    expect(account.fullAid).toBe("legacy-bot.agentcp.io");
  });

  it("resolveAccount throws for unknown accountId in multi-identity mode", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          identities: {
            work: { agentName: "work-bot", domain: "agentcp.io" },
          },
        },
      },
    };
    expect(() => adapter.resolveAccount(cfg, "unknown")).toThrow(/not found/);
  });

  it("defaultAccountId prefers default when present", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          identities: {
            work: { agentName: "work-bot", domain: "agentcp.io" },
            default: { agentName: "legacy-bot", domain: "agentcp.io" },
          },
        },
      },
    };
    expect(adapter.defaultAccountId?.(cfg)).toBe("default");
  });

  it("resolveAccount includes agentAidBindingMode fallback (strict)", () => {
    const cfg = {
      channels: {
        acp: {
          enabled: true,
          agentName: "legacy-bot",
          domain: "agentcp.io",
        },
      },
    };
    const account = adapter.resolveAccount(cfg, "default");
    expect((account as any).agentAidBindingMode).toBe("strict");
  });
});
