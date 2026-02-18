// IMPORTANT: Import polyfill FIRST before any related imports
import "./src/node-polyfill.js";

import type { OpenClawPluginApi, OpenClawConfig } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { acpChannelPlugin } from "./src/channel.js";
import { setAcpRuntime } from "./src/runtime.js";
import { updateWorkspaceDir } from "./src/workspace.js";
import { checkAndUploadAgentMd } from "./src/monitor.js";
import { createFetchAgentMdTool, createManageContactsTool } from "./src/tools.js";
import { createGroupTool } from "./src/group-tools.js";
import { createSyncCommand, createStatusCommand } from "./src/commands.js";

function resolveAcpAccountIdsForAgent(cfg: OpenClawConfig | undefined, agentId?: string): string[] {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId) {
    return ["default"];
  }

  const bindings = cfg?.bindings;
  if (!Array.isArray(bindings)) {
    return ["default"];
  }

  const accountIds = new Set<string>();
  for (const binding of bindings) {
    if (!binding || binding.agentId !== normalizedAgentId) continue;
    if (binding.match?.channel !== "acp") continue;
    const accountId = binding.match.accountId?.trim() || "default";
    accountIds.add(accountId);
  }

  return accountIds.size > 0 ? Array.from(accountIds) : ["default"];
}

const plugin = {
  id: "acp",
  name: "ACP Channel",
  description: "Agent Communication Protocol channel plugin for ACP network communication",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    console.log("[ACP] Registering ACP channel plugin");

    // 保存 runtime 引用
    setAcpRuntime(api.runtime);

    // 注册 channel
    // TODO: 本地 ChannelPlugin 类型与 SDK 类型未对齐，待 openclaw SDK 导出兼容类型后移除断言
    api.registerChannel({ plugin: acpChannelPlugin as any });

    // 通过 before_agent_start 钩子自动发现 workspaceDir 并检查同步
    api.on("before_agent_start", async (_event, ctx) => {
      if (ctx.workspaceDir) {
        const accountIds = resolveAcpAccountIdsForAgent(api.config, ctx.agentId);
        for (const accountId of accountIds) {
          updateWorkspaceDir(ctx.workspaceDir, accountId);
          await checkAndUploadAgentMd(accountId);
        }
      }
    });

    // 钩子：gateway 停止时记录日志
    api.on("gateway_stop", (_event, _ctx) => {
      console.log("[ACP] Gateway stopped");
    });

    // 钩子：session 结束（框架未实际触发，注册以备未来生效）
    api.on("session_end", async (event, _ctx) => {
      console.log(`[ACP] session_end hook: ${(event as any).sessionId ?? "unknown"}`);
    });

    // 注册 AI 工具
    api.registerTool(createFetchAgentMdTool(), { names: ["acp_fetch_agent_md"] });
    api.registerTool(createManageContactsTool(), { names: ["acp_manage_contacts"] });
    api.registerTool(createGroupTool(), { names: ["acp_group"] });

    // 注册用户命令
    api.registerCommand(createSyncCommand());
    api.registerCommand(createStatusCommand());

    console.log("[ACP] ACP channel plugin registered (gateway lifecycle managed by framework)");
  },
};

export default plugin;
