// IMPORTANT: Import polyfill FIRST before any related imports
import "./src/node-polyfill.js";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { acpChannelPlugin } from "./src/channel.js";
import { setAcpRuntime } from "./src/runtime.js";

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

    console.log("[ACP] ACP channel plugin registered (gateway lifecycle managed by framework)");
  },
};

export default plugin;
