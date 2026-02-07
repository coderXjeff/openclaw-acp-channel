// IMPORTANT: Import polyfill FIRST before any related imports
import "./src/node-polyfill.js";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { acpChannelPlugin } from "./src/channel.js";
import { setAcpRuntime } from "./src/runtime.js";
import { updateWorkspaceDir } from "./src/workspace.js";
import { checkAndUploadAgentMd } from "./src/monitor.js";
import { createFetchAgentMdTool, createManageContactsTool } from "./src/tools.js";
import { createSyncCommand, createStatusCommand } from "./src/commands.js";

const plugin = {
  id: "acp",
  name: "ACP Channel",
  description: "Agent Communication Protocol channel plugin for ACP network communication",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    console.log("[ACP] Registering ACP channel plugin");

    // 保存 runtime 引用
    setAcpRuntime(api.runtime);

    // 注册 channel (使用 any 避免类型冲突)
    // gateway.startAccount 会由框架在账户启用时自动调用
    api.registerChannel({ plugin: acpChannelPlugin as any });

    // 通过 before_agent_start 钩子自动发现 workspaceDir 并检查同步
    api.on("before_agent_start", async (_event, ctx) => {
      if (ctx.workspaceDir) {
        updateWorkspaceDir(ctx.workspaceDir);
        await checkAndUploadAgentMd();
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

    // 注册用户命令
    api.registerCommand(createSyncCommand());
    api.registerCommand(createStatusCommand());

    console.log("[ACP] ACP channel plugin registered (gateway lifecycle managed by framework)");
  },
};

export default plugin;
