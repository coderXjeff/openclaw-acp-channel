// IMPORTANT: Import polyfill FIRST before any related imports
import "./src/node-polyfill.js";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { acpChannelPlugin } from "./src/channel.js";
import { startAcpMonitor, stopAcpMonitor } from "./src/monitor.js";
import { setAcpRuntime } from "./src/runtime.js";
import type { AcpChannelConfig } from "./src/types.js";

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
    api.registerChannel({ plugin: acpChannelPlugin as any });

    // 获取配置
    const cfg = api.config;
    const acpConfig = cfg?.channels?.acp as AcpChannelConfig | undefined;

    console.log("[ACP] Config check:", {
      hasConfig: !!cfg,
      hasChannels: !!cfg?.channels,
      hasAcp: !!cfg?.channels?.acp,
      enabled: acpConfig?.enabled,
      agentName: acpConfig?.agentName,
      domain: acpConfig?.domain,
    });

    if (acpConfig?.enabled && acpConfig?.agentName) {
      console.log("[ACP] Config found, starting ACP connection...");
      const account = acpChannelPlugin.config.resolveAccount(cfg, "default");

      if (account.enabled) {
        // 异步启动，不阻塞注册
        startAcpMonitor(cfg, acpConfig, account)
          .then(() => {
            console.log("[ACP] ACP connection established");
          })
          .catch((error) => {
            console.error("[ACP] Failed to connect to ACP network:", error);
          });
      } else {
        console.log("[ACP] Account not enabled");
      }
    } else {
      console.log("[ACP] ACP channel not enabled or not configured");
    }
  },
};

export default plugin;
