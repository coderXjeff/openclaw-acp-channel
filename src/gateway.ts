import type { ChannelGatewayAdapter, ChannelGatewayContext } from "./plugin-types.js";
import type { ResolvedAcpAccount, AcpChannelConfig } from "./types.js";
import { startIdentityWithGateway, stopIdentityFromGateway } from "./monitor.js";
import { hasAcpRuntime } from "./runtime.js";

export const acpGatewayAdapter: ChannelGatewayAdapter<ResolvedAcpAccount> = {
  startAccount: async (ctx: ChannelGatewayContext<ResolvedAcpAccount>) => {
    const log = ctx.log ?? { info: console.log, warn: console.warn, error: console.error };

    if (!hasAcpRuntime()) {
      log.error(`[${ctx.accountId}] PluginRuntime not initialized — register() may not have been called`);
      ctx.setStatus({
        accountId: ctx.accountId,
        running: false,
        lastError: "PluginRuntime not initialized",
      });
      return;
    }

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

    // 启动该身份的 ACP 连接（带自动重连）
    await startIdentityWithGateway(ctx, acpConfig);
  },

  stopAccount: async (ctx: ChannelGatewayContext<ResolvedAcpAccount>) => {
    await stopIdentityFromGateway(ctx);
  },
};
