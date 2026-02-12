/**
 * ACP 多身份客户端 — 管理多个 AID 实例
 * 每个 AID 拥有独立的 AgentWS + HeartbeatClient + FileSync
 *
 * acp-ts 1.1.2 适配：
 * - AgentManager 是单例，initACP/initAWS 会覆盖上一个实例
 * - 通过 connectLock 串行化连接流程，确保 initACP → loadAid → online → initAWS 原子执行
 * - 每个 AID 存储独立的 IAgentWS 引用（不依赖 manager.aws()）
 * - FileSync 不再通过 AgentManager，直接实例化
 */
import { AgentManager, HeartbeatClient } from "acp-ts";
import type { ConnectionStatus } from "acp-ts";
import type { IAgentWS } from "acp-ts/dist/interfaces.js";
import { FileSync, type FileSyncConfig } from "acp-ts/dist/filesync.js";
import type { AcpSession } from "./types.js";

export type { ConnectionStatus };

export interface AidInstanceOptions {
  agentName: string;
  domain: string;
  seedPassword?: string;
  agentMdPath?: string;
  onMessage: (receiverAid: string, sender: string, sessionId: string, identifyingCode: string, content: string) => void;
  onStatusChange?: (aid: string, status: ConnectionStatus) => void;
  onError?: (aid: string, error: Error) => void;
}

interface AidInstance {
  aid: string;
  agentWS: IAgentWS;
  fileSync: FileSync | null;
  heartbeat: HeartbeatClient | null;
  sessions: Map<string, AcpSession>;
  sessionsBySessionId: Map<string, AcpSession>;
  isOnline: boolean;
}

export class AcpMultiClient {
  private instances = new Map<string, AidInstance>();
  // 串行化连接流程（AgentManager 单例约束）
  private connectLock: Promise<void> = Promise.resolve();

  /**
   * 为一个 AID 创建独立连接
   */
  async connectAid(opts: AidInstanceOptions): Promise<string> {
    const fullAid = `${opts.agentName}.${opts.domain}`;
    if (this.instances.has(fullAid)) {
      console.log(`[ACP-Multi] ${fullAid} already connected`);
      return fullAid;
    }

    console.log(`[ACP-Multi] Connecting ${fullAid}...`);
    opts.onStatusChange?.(fullAid, "connecting");

    // 串行化：AgentManager.initACP/initAWS 会覆盖上一个实例
    const connectPromise = this.connectLock.then(async () => {
      const manager = AgentManager.getInstance();

      // 1. initACP（每个 AID 可能有不同的 seedPassword）
      const acp = manager.initACP(opts.domain, opts.seedPassword || "");
      if (opts.agentMdPath) {
        acp.setAgentMdPath(opts.agentMdPath);
      }

      // 2. 加载或创建 AID
      let loadedAid = await acp.loadAid(fullAid);
      if (!loadedAid) {
        console.log(`[ACP-Multi] AID ${fullAid} not found, creating...`);
        loadedAid = await acp.createAid(fullAid);
      }

      // 3. 上线获取连接配置
      const config = await acp.online();

      // 4. initAWS — 立即存储返回的 IAgentWS 引用
      const aws = manager.initAWS(fullAid, config);

      // 5. 创建 FileSync（直接实例化，不依赖 manager）
      let fileSync: FileSync | null = null;
      if (config.messageSignature) {
        const localDir = opts.agentMdPath
          ? opts.agentMdPath.replace(/\/[^/]+$/, "")
          : undefined;
        fileSync = new FileSync({
          apiUrl: `https://acp3.${opts.domain}/api/message`,
          aid: fullAid,
          signature: config.messageSignature,
          localDir,
        });
      }

      return { aws, fileSync, config };
    });
    this.connectLock = connectPromise.then(() => {}, () => {});

    try {
      const { aws, fileSync, config } = await connectPromise;

      const instance: AidInstance = {
        aid: fullAid,
        agentWS: aws,
        fileSync,
        heartbeat: null,
        sessions: new Map(),
        sessionsBySessionId: new Map(),
        isOnline: false,
      };
      // 6. 注册状态回调
      aws.onStatusChange((status) => {
        console.log(`[ACP-Multi] ${fullAid} WS status: ${status}`);
        instance.isOnline = status === "connected";
        opts.onStatusChange?.(fullAid, status);
      });

      // 7. 注册消息回调
      aws.onMessage((message) => {
        this.handleIncomingMessage(instance, opts, message);
      });

      // 8. 启动 WebSocket
      await aws.startWebSocket();

      // 9. 启动心跳
      if (config.heartbeatServer) {
        instance.heartbeat = new HeartbeatClient(
          fullAid,
          config.heartbeatServer,
          opts.seedPassword || ""
        );
        instance.heartbeat.onStatusChange((status) => {
          console.log(`[ACP-Multi] ${fullAid} heartbeat: ${status}`);
        });
        instance.heartbeat.onInvite((invite) => {
          (aws as any).acceptInviteFromHeartbeat(
            invite.sessionId, invite.inviterAgentId, invite.inviteCode
          );
        });
        await instance.heartbeat.online();
      }

      instance.isOnline = true;
      this.instances.set(fullAid, instance);
      opts.onStatusChange?.(fullAid, "connected");
      console.log(`[ACP-Multi] ${fullAid} connected`);

    } catch (error) {
      opts.onStatusChange?.(fullAid, "error");
      opts.onError?.(fullAid, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    return fullAid;
  }

  private handleIncomingMessage(instance: AidInstance, opts: AidInstanceOptions, message: any): void {
    try {
      const data = message.data || message;
      const sender = data.sender;
      const sessionId = data.session_id;
      const identifyingCode = data.identifying_code || "";

      if (sender === instance.aid) return;

      let content = "";
      try {
        const msgContent = data.message;
        if (msgContent) {
          const decoded = decodeURIComponent(msgContent);
          const parsed = JSON.parse(decoded);
          if (Array.isArray(parsed) && parsed.length > 0) {
            content = parsed[0].content || "";
          }
        }
      } catch {
        content = String(data.message || message);
      }

      if (!content) return;

      let session = instance.sessionsBySessionId.get(sessionId);
      if (!session) {
        session = { sessionId, identifyingCode, targetAid: sender, createdAt: Date.now() };
        instance.sessions.set(sender, session);
        instance.sessionsBySessionId.set(sessionId, session);
      } else if (!session.identifyingCode && identifyingCode) {
        session.identifyingCode = identifyingCode;
      }

      opts.onMessage(instance.aid, sender, sessionId, session.identifyingCode, content);
    } catch (error) {
      console.error(`[ACP-Multi] ${instance.aid} message handling error:`, error);
    }
  }

  disconnectAid(fullAid: string): void {
    const instance = this.instances.get(fullAid);
    if (!instance) return;

    console.log(`[ACP-Multi] Disconnecting ${fullAid}`);
    try { instance.agentWS.disconnect(); } catch { /* ignore */ }
    if (instance.heartbeat) {
      instance.heartbeat.offline();
    }
    instance.isOnline = false;
    instance.sessions.clear();
    instance.sessionsBySessionId.clear();
    this.instances.delete(fullAid);
  }

  disconnectAll(): void {
    for (const aid of Array.from(this.instances.keys())) {
      this.disconnectAid(aid);
    }
  }

  async sendMessage(fromAid: string, targetAid: string, content: string): Promise<void> {
    const instance = this.instances.get(fromAid);
    if (!instance?.isOnline) {
      throw new Error(`AID ${fromAid} not connected`);
    }

    let cleanTarget = targetAid.replace(/^acp:/, "").replace(/^g-/, "").trim();
    if (cleanTarget === fromAid) return;

    const aws = instance.agentWS;
    const existingSession = instance.sessions.get(cleanTarget);
    if (existingSession?.identifyingCode) {
      aws.send(content, cleanTarget, existingSession.sessionId, existingSession.identifyingCode);
      return;
    }

    const INVITE_TIMEOUT_MS = 30_000;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Invite to ${cleanTarget} timed out`));
      }, INVITE_TIMEOUT_MS);

      aws.connectTo(
        cleanTarget,
        (sessionInfo) => {
          const newSession: AcpSession = {
            sessionId: sessionInfo.sessionId,
            identifyingCode: sessionInfo.identifyingCode,
            targetAid: cleanTarget,
            createdAt: Date.now(),
          };
          instance.sessions.set(cleanTarget, newSession);
          instance.sessionsBySessionId.set(sessionInfo.sessionId, newSession);
        },
        (inviteStatus) => {
          clearTimeout(timer);
          if (inviteStatus === "success") {
            const session = instance.sessions.get(cleanTarget);
            if (session) {
              aws.send(content, cleanTarget, session.sessionId, session.identifyingCode);
              resolve();
            } else {
              reject(new Error(`Session lost for ${cleanTarget}`));
            }
          } else {
            reject(new Error(`Invite to ${cleanTarget} failed`));
          }
        }
      );
    });
  }

  async sendReply(fromAid: string, sessionId: string, content: string): Promise<void> {
    const instance = this.instances.get(fromAid);
    if (!instance?.isOnline) {
      throw new Error(`AID ${fromAid} not connected`);
    }

    const session = instance.sessionsBySessionId.get(sessionId);
    if (!session) {
      console.warn(`[ACP-Multi] No session ${sessionId} for ${fromAid}`);
      return;
    }

    instance.agentWS.send(content, session.targetAid, sessionId, session.identifyingCode || "");
  }

  async uploadAgentMd(fromAid: string, content: string): Promise<{ success: boolean; url?: string; error?: string }> {
    const instance = this.instances.get(fromAid);
    if (!instance) return { success: false, error: `AID ${fromAid} not connected` };
    if (!instance.fileSync) return { success: false, error: "FileSync not initialized" };

    try {
      return await instance.fileSync.uploadAgentMd(content);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async uploadAgentMdFromFile(fromAid: string, filePath: string): Promise<{ success: boolean; url?: string; error?: string }> {
    const instance = this.instances.get(fromAid);
    if (!instance) return { success: false, error: `AID ${fromAid} not connected` };
    if (!instance.fileSync) return { success: false, error: "FileSync not initialized" };

    try {
      return await instance.fileSync.uploadAgentMdFromFile(filePath);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  isConnected(fullAid: string): boolean {
    return this.instances.get(fullAid)?.isOnline ?? false;
  }

  getConnectedAids(): string[] {
    return Array.from(this.instances.keys()).filter(aid => this.instances.get(aid)!.isOnline);
  }
}