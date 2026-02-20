import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { AcpChannelConfig } from "./types.js";

export type BindingIssue = {
  level: "error" | "warn";
  message: string;
};

export type AcpBindingAnalysis = {
  mode: "strict" | "flex";
  hasAcpBindings: boolean;
  hasMultiIdentities: boolean;
  agentToAccounts: Map<string, string[]>;
  issues: BindingIssue[];
};

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSetMapPush(map: Map<string, Set<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
}

export function analyzeAcpBindings(cfg: OpenClawConfig | undefined, acpConfig: AcpChannelConfig | undefined): AcpBindingAnalysis {
  const mode = acpConfig?.agentAidBindingMode ?? "strict";
  const identities = acpConfig?.identities ?? {};
  const identityIds = Object.keys(identities);
  const hasMultiIdentities = identityIds.length > 0;
  const issues: BindingIssue[] = [];

  const agentToAccountsSet = new Map<string, Set<string>>();
  const accountToAgentsSet = new Map<string, Set<string>>();
  const acpBindings = (cfg?.bindings ?? []).filter((binding) => binding?.match?.channel === "acp");
  const hasAcpBindings = acpBindings.length > 0;

  for (const binding of acpBindings) {
    const agentId = normalizeId(binding?.agentId);
    const accountId = normalizeId(binding?.match?.accountId);

    if (!agentId) {
      issues.push({ level: "error", message: "ACP binding has empty agentId" });
      continue;
    }

    if (hasMultiIdentities) {
      if (!accountId) {
        issues.push({
          level: mode === "strict" ? "error" : "warn",
          message: `ACP binding agentId=${agentId} is missing accountId in multi-identity mode`,
        });
        continue;
      }
      if (!identities[accountId]) {
        issues.push({
          level: mode === "strict" ? "error" : "warn",
          message: `ACP binding accountId=${accountId} not found in channels.acp.identities`,
        });
      }
      toSetMapPush(agentToAccountsSet, agentId, accountId);
      toSetMapPush(accountToAgentsSet, accountId, agentId);
      if (agentId !== accountId) {
        issues.push({
          level: mode === "strict" ? "error" : "warn",
          message: `Recommended 1:1 naming violated: agentId=${agentId} should equal accountId=${accountId}`,
        });
      }
    } else {
      const resolvedAccountId = accountId ?? "default";
      if (resolvedAccountId !== "default") {
        issues.push({
          level: mode === "strict" ? "error" : "warn",
          message: `Single-identity mode only supports accountId=default, got ${resolvedAccountId}`,
        });
      }
      toSetMapPush(agentToAccountsSet, agentId, "default");
      toSetMapPush(accountToAgentsSet, "default", agentId);
    }
  }

  if (mode === "strict") {
    for (const [agentId, accounts] of agentToAccountsSet.entries()) {
      if (accounts.size > 1) {
        issues.push({
          level: "error",
          message: `Strict mode forbids one agent mapped to multiple ACP accounts: agentId=${agentId}, accounts=[${Array.from(accounts).join(", ")}]`,
        });
      }
    }
    for (const [accountId, agents] of accountToAgentsSet.entries()) {
      if (agents.size > 1) {
        issues.push({
          level: "error",
          message: `Strict mode forbids one ACP account mapped to multiple agents: accountId=${accountId}, agents=[${Array.from(agents).join(", ")}]`,
        });
      }
    }
  }

  if (hasMultiIdentities && hasAcpBindings) {
    for (const identityId of identityIds) {
      if (!accountToAgentsSet.has(identityId)) {
        issues.push({
          level: "warn",
          message: `ACP identity ${identityId} has no binding and will not receive inbound routing`,
        });
      }
    }
  }

  const agentToAccounts = new Map<string, string[]>();
  for (const [agentId, set] of agentToAccountsSet.entries()) {
    agentToAccounts.set(agentId, Array.from(set));
  }

  return {
    mode,
    hasAcpBindings,
    hasMultiIdentities,
    agentToAccounts,
    issues,
  };
}
