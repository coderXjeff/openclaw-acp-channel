/**
 * ACP 身份路由器 — AID ↔ 身份的固定映射 + 入站消息路由
 * 每个身份拥有独立的运行时状态（会话、联系人、agent.md）
 */
import type { ResolvedAcpAccount, AcpChannelConfig, IdentityAcpState } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ChannelGatewayContext, ChannelLogSink } from "./plugin-types.js";
import { AcpMultiClient, type AidInstanceOptions } from "./acp-multi-client.js";
import type { ConnectionStatus } from "./acp-client.js";
import { getContactManager } from "./contacts.js";

export class AcpIdentityRouter {
  // AID → identityId 固定映射
  private aidToIdentityId = new Map<string, string>();
  // identityId → 运行时状态
  private states = new Map<string, IdentityAcpState>();
  // 共享的多 AID 客户端
  public multiClient: AcpMultiClient;
  // 入站消息处理器（由 monitor.ts 注入）
  private inboundHandler: ((state: IdentityAcpState, sender: string, sessionId: string, identifyingCode: string, content: string) => void) | null = null;
  // 共享配置
  private currentConfig: OpenClawConfig | null = null;
  private currentAcpConfig: AcpChannelConfig | null = null;

  constructor() {
    this.multiClient = new AcpMultiClient();
  }

  /**
   * 注册入站消息处理器
   */
  setInboundHandler(handler: (state: IdentityAcpState, sender: string, sessionId: string, identifyingCode: string, content: string) => void): void {
    this.inboundHandler = handler;
  }

  /**
   * 注册一个身份
   */
  registerIdentity(identityId: string, account: ResolvedAcpAccount): void {
    const state: IdentityAcpState = {
      identityId,
      account,
      aidKey: account.fullAid,
      sessionStates: new Map(),
      isRunning: false,
      lastConnectedAt: null,
      lastInboundAt: null,
      lastOutboundAt: null,
      reconnectAttempts: 0,
      lastError: null,
      idleCheckInterval: null,
    };

    this.states.set(identityId, state);
    this.aidToIdentityId.set(account.fullAid, identityId);
    console.log(`[ACP-Router] Registered identity ${identityId} → ${account.fullAid}`);
  }

  /**
   * 通过 AID 查找身份状态
   */
  getStateByAid(aid: string): IdentityAcpState | undefined {
    const identityId = this.aidToIdentityId.get(aid);
    return identityId ? this.states.get(identityId) : undefined;
  }

  /**
   * 通过 identityId 查找身份状态
   */
  getState(identityId: string): IdentityAcpState | undefined {
    return this.states.get(identityId);
  }

  /**
   * 获取默认身份状态（兼容单身份模式）
   */
  getDefaultState(): IdentityAcpState | undefined {
    return this.states.get("default") ?? this.states.values().next().value;
  }

  /**
   * 列出所有身份 ID
   */
  listIdentityIds(): string[] {
    return Array.from(this.states.keys());
  }

  /**
   * 设置共享配置
   */
  setConfig(cfg: OpenClawConfig, acpConfig: AcpChannelConfig): void {
    this.currentConfig = cfg;
    this.currentAcpConfig = acpConfig;
  }

  getConfig(): OpenClawConfig | null {
    return this.currentConfig;
  }

  getAcpConfig(): AcpChannelConfig | null {
    return this.currentAcpConfig;
  }

  /**
   * 启动单个身份的 ACP 连接
   */
  async startIdentity(
    identityId: string,
    cfg: OpenClawConfig,
    acpConfig: AcpChannelConfig,
    ctx?: ChannelGatewayContext<ResolvedAcpAccount>
  ): Promise<void> {
    const state = this.states.get(identityId);
    if (!state) {
      throw new Error(`Identity ${identityId} not registered`);
    }

    this.currentConfig = cfg;
    this.currentAcpConfig = acpConfig;

    const log = ctx?.log ?? { info: console.log, warn: console.warn, error: console.error };

    const opts: AidInstanceOptions = {
      agentName: state.account.agentName,
      domain: state.account.domain,
      seedPassword: state.account.seedPassword,
      agentMdPath: state.account.agentMdPath,
      onMessage: (receiverAid, sender, sessionId, identifyingCode, content) => {
        state.lastInboundAt = Date.now();
        this.routeInbound(receiverAid, sender, sessionId, identifyingCode, content);
      },
      onStatusChange: (aid: string, status: ConnectionStatus) => {
        log.info(`[ACP-Router] ${aid} status: ${status}`);
        if (status === "connected") {
          state.isRunning = true;
          state.lastConnectedAt = Date.now();
          state.reconnectAttempts = 0;
          state.lastError = null;
        } else if (status === "disconnected" || status === "error") {
          state.isRunning = false;
        }
      },
      onError: (aid: string, error: Error) => {
        log.error(`[ACP-Router] ${aid} error: ${error.message}`);
        state.lastError = error.message;
      },
    };

    await this.multiClient.connectAid(opts);
    state.isRunning = true;
  }

  /**
   * 停止单个身份
   */
  async stopIdentity(identityId: string): Promise<void> {
    const state = this.states.get(identityId);
    if (!state) return;

    if (state.idleCheckInterval) {
      clearInterval(state.idleCheckInterval);
      state.idleCheckInterval = null;
    }

    this.multiClient.disconnectAid(state.aidKey);
    state.isRunning = false;
    state.sessionStates.clear();
    console.log(`[ACP-Router] Stopped identity ${identityId}`);
  }

  /**
   * 停止所有身份
   */
  async stopAll(): Promise<void> {
    for (const identityId of this.states.keys()) {
      await this.stopIdentity(identityId);
    }
    this.states.clear();
    this.aidToIdentityId.clear();
  }

  /**
   * 路由入站消息到对应身份
   */
  private routeInbound(
    receiverAid: string,
    sender: string,
    sessionId: string,
    identifyingCode: string,
    content: string
  ): void {
    const identityId = this.aidToIdentityId.get(receiverAid);
    if (!identityId) {
      console.warn(`[ACP-Router] No identity mapped for AID ${receiverAid}`);
      return;
    }

    const state = this.states.get(identityId);
    if (!state) {
      console.warn(`[ACP-Router] State not found for identity ${identityId}`);
      return;
    }

    if (this.inboundHandler) {
      this.inboundHandler(state, sender, sessionId, identifyingCode, content);
    } else {
      console.warn(`[ACP-Router] No inbound handler registered`);
    }
  }

  /**
   * 记录出站时间戳
   */
  recordOutbound(identityId: string): void {
    const state = this.states.get(identityId);
    if (state) {
      state.lastOutboundAt = Date.now();
    }
  }
}

// 模块级单例
let routerInstance: AcpIdentityRouter | null = null;

export function getOrCreateRouter(): AcpIdentityRouter {
  if (!routerInstance) {
    routerInstance = new AcpIdentityRouter();
  }
  return routerInstance;
}

export function getRouter(): AcpIdentityRouter | null {
  return routerInstance;
}

export function resetRouter(): void {
  if (routerInstance) {
    routerInstance.stopAll().catch(() => {});
    routerInstance = null;
  }
}
