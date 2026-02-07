import type { ChannelGatewayAdapter, ChannelGatewayContext } from "./plugin-types.js";
import type { ResolvedAcpAccount, AcpChannelConfig } from "./types.js";
import { startAcpMonitorWithGateway, stopAcpMonitorFromGateway } from "./monitor.js";
import { hasAcpRuntime } from "./runtime.js";

export const acpGatewayAdapter: ChannelGatewayAdapter<ResolvedAcpAccount> = {
  startAccount: async (ctx: ChannelGatewayContext<ResolvedAcpAccount>) => {
    const log = ctx.log ?? { info: console.log, warn: console.warn, error: console.error };

    // 注意：不要用 ctx.runtime (RuntimeEnv) 覆盖 PluginRuntime
    // PluginRuntime 已在 index.ts 的 register() 中通过 setAcpRuntime(api.runtime) 设置
    // ctx.runtime 是 RuntimeEnv（只有 log/error/exit），缺少 channel.session/reply 等方法
    if (!hasAcpRuntime()) {
      log.error(`[${ctx.accountId}] PluginRuntime not initialized — register() may not have been called`);
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        lastError: "PluginRuntime not initialized",
      });
      return;
    }

    // 从配置中提取 ACP 配置
    const acpConfig = ctx.cfg.channels?.acp as AcpChannelConfig | undefined;
    if (!acpConfig) {
      log.error(`[${ctx.accountId}] No ACP config found`);
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        lastError: "No ACP config found",
      });
      return;
    }

    // 启动带重连的 gateway 循环
    await startAcpMonitorWithGateway(ctx, acpConfig);
  },

  stopAccount: async (ctx: ChannelGatewayContext<ResolvedAcpAccount>) => {
    await stopAcpMonitorFromGateway(ctx);
  },
};
