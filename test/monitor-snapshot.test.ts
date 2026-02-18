import { describe, it, expect, beforeEach } from "vitest";
import { getConnectionSnapshot, stopIdentityFromGateway } from "../src/monitor.js";
import { getOrCreateRouter, resetRouter } from "../src/identity-router.js";
import type { ChannelGatewayContext } from "../src/plugin-types.js";
import type { ResolvedAcpAccount } from "../src/types.js";

function fakeGatewayCtx(accountId: string): ChannelGatewayContext<ResolvedAcpAccount> {
  const account: ResolvedAcpAccount = {
    accountId,
    identityId: accountId,
    agentName: `${accountId}-bot`,
    domain: "agentcp.io",
    fullAid: `${accountId}-bot.agentcp.io`,
    enabled: true,
    ownerAid: "",
    allowFrom: [],
    seedPassword: "",
  };
  return {
    cfg: {},
    accountId,
    account,
    runtime: {},
    abortSignal: new AbortController().signal,
    getStatus: () => ({ accountId }),
    setStatus: () => {},
  };
}

describe("connection snapshot identity isolation", () => {
  beforeEach(() => {
    resetRouter();
  });

  it("keeps per-identity stop timestamp", async () => {
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
    router.registerIdentity("personal", {
      accountId: "personal",
      identityId: "personal",
      agentName: "personal-bot",
      domain: "agentcp.io",
      fullAid: "personal-bot.agentcp.io",
      enabled: true,
      ownerAid: "",
      allowFrom: [],
      seedPassword: "",
    });

    await stopIdentityFromGateway(fakeGatewayCtx("work"));

    const work = getConnectionSnapshot("work");
    const personal = getConnectionSnapshot("personal");
    expect(work.lastStopAt).not.toBeNull();
    expect(personal.lastStopAt).toBeNull();
  });
});
