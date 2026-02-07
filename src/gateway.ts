import type { ChannelGatewayAdapter, ChannelGatewayContext } from "./plugin-types.js";
import type { ResolvedAcpAccount, AcpChannelConfig } from "./types.js";
import { startAcpMonitorWithGateway, stopAcpMonitorFromGateway } from "./monitor.js";
import { setAcpRuntime } from "./runtime.js";

export const acpGatewayAdapter: ChannelGatewayAdapter<ResolvedAcpAccount> = {
  startAccount: async (ctx: ChannelGatewayContext<ResolvedAcpAccount>) => {
    const log = ctx.log ?? { info: console.log, warn: console.warn, error: console.error };

    // 确保 runtime 已设置
    setAcpRuntime(ctx.runtime);

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
