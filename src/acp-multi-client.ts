/**
 * ACP 多身份客户端 — 绕过 AgentManager 单例，直接管理多个 AID 实例
 * 每个 AID 拥有独立的 AgentCP + AgentWS + HeartbeatClient + FileSync
 */
import { AgentManager, HeartbeatClient } from "acp-ts";
import type { AgentWSExt } from "./acp-ts-ext.js";
import type { AcpSession } from "./types.js";
import type { ConnectionStatus } from "./acp-client.js";

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
  manager: ReturnType<typeof AgentManager.getInstance>;
  heartbeat: HeartbeatClient | null;
  sessions: Map<string, AcpSession>;
  sessionsBySessionId: Map<string, AcpSession>;
  isOnline: boolean;
}

export class AcpMultiClient {
  private instances = new Map<string, AidInstance>();

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

    try {
      // 每个 AID 使用独立的 AgentManager 实例
      // 注意：AgentManager.getInstance() 是单例，但我们可以直接使用它管理多个 AID
      // acp-ts 内部的 aidInstances Map 支持同时上线多个 AID
      const manager = AgentManager.getInstance();

      // 1. 初始化 AgentCP
      const acp = manager.initACP(opts.domain, opts.seedPassword || "");

      // 1.5 设置 agent.md 路径
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

      // 3.5 初始化 FileSync
      if (config.messageSignature) {
        const localDir = opts.agentMdPath
          ? opts.agentMdPath.replace(/\/[^/]+$/, "")
          : "";
        manager.initFileSync(fullAid, config.messageSignature, localDir);
      }

      // 4. 初始化 WebSocket
      const aws = manager.initAWS(fullAid, config);

      const instance: AidInstance = {
        aid: fullAid,
        manager,
        heartbeat: null,
        sessions: new Map(),
        sessionsBySessionId: new Map(),
        isOnline: false,
      };

      // 5. 注册状态回调
      aws.onStatusChange((status) => {
        console.log(`[ACP-Multi] ${fullAid} WS status: ${status}`);
        instance.isOnline = status === "connected";
        opts.onStatusChange?.(fullAid, status);
      });

      // 6. 注册消息回调
      aws.onMessage((message) => {
        this.handleIncomingMessage(instance, opts, message);
      });

      // 7. 启动 WebSocket
      await aws.startWebSocket();

      // 8. 启动心跳
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
          (aws as unknown as AgentWSExt).acceptInviteFromHeartbeat(
            invite.sessionId, invite.inviterAgentId, invite.inviteCode
          );
        });
        await instance.heartbeat.online();
      }

      instance.isOnline = true;
      this.instances.set(fullAid, instance);
      opts.onStatusChange?.(fullAid, "connected");
      console.log(`[ACP-Multi] ${fullAid} connected`);
      return fullAid;

    } catch (error) {
      opts.onStatusChange?.(fullAid, "error");
      opts.onError?.(fullAid, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 处理收到的消息
   */
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

      // 更新会话记录
      let session = instance.sessionsBySessionId.get(sessionId);
      if (!session) {
        session = { sessionId, identifyingCode, targetAid: sender, createdAt: Date.now() };
        instance.sessions.set(sender, session);
        instance.sessionsBySessionId.set(sessionId, session);
      } else if (!session.identifyingCode && identifyingCode) {
        session.identifyingCode = identifyingCode;
      }

      // 回调时带上 receiverAid，让 router 知道消息发给了哪个 AID
      opts.onMessage(instance.aid, sender, sessionId, session.identifyingCode, content);
    } catch (error) {
      console.error(`[ACP-Multi] ${instance.aid} message handling error:`, error);
    }
  }

  /**
   * 断开指定 AID
   */
  disconnectAid(fullAid: string): void {
    const instance = this.instances.get(fullAid);
    if (!instance) return;

    console.log(`[ACP-Multi] Disconnecting ${fullAid}`);
    try {
      instance.manager.aws().disconnect();
    } catch { /* ignore */ }
    if (instance.heartbeat) {
      instance.heartbeat.offline();
    }
    instance.isOnline = false;
    instance.sessions.clear();
    instance.sessionsBySessionId.clear();
    this.instances.delete(fullAid);
  }

  /**
   * 断开所有 AID
   */
  disconnectAll(): void {
    for (const aid of Array.from(this.instances.keys())) {
      this.disconnectAid(aid);
    }
  }

  /**
   * 用指定 AID 发送消息
   */
  async sendMessage(fromAid: string, targetAid: string, content: string): Promise<void> {
    const instance = this.instances.get(fromAid);
    if (!instance?.isOnline) {
      throw new Error(`AID ${fromAid} not connected`);
    }

    let cleanTarget = targetAid.replace(/^acp:/, "").replace(/^g-/, "").trim();
    if (cleanTarget === fromAid) return;

    const aws = instance.manager.aws();
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

  /**
   * 用指定 AID 回复消息
   */
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

    instance.manager.aws().send(content, session.targetAid, sessionId, session.identifyingCode || "");
  }

  /**
   * 上传 agent.md
   */
  async uploadAgentMd(fromAid: string, content: string): Promise<{ success: boolean; url?: string; error?: string }> {
    const instance = this.instances.get(fromAid);
    if (!instance) return { success: false, error: `AID ${fromAid} not connected` };

    try {
      const fs = instance.manager.fs();
      if (!fs) return { success: false, error: "FileSync not initialized" };
      return await fs.uploadAgentMd(content);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 从文件上传 agent.md
   */
  async uploadAgentMdFromFile(fromAid: string, filePath: string): Promise<{ success: boolean; url?: string; error?: string }> {
    const instance = this.instances.get(fromAid);
    if (!instance) return { success: false, error: `AID ${fromAid} not connected` };

    try {
      const fs = instance.manager.fs();
      if (!fs) return { success: false, error: "FileSync not initialized" };
      return await fs.uploadAgentMdFromFile(filePath);
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 查询连接状态
   */
  isConnected(fullAid: string): boolean {
    return this.instances.get(fullAid)?.isOnline ?? false;
  }

  /**
   * 获取所有已连接的 AID
   */
  getConnectedAids(): string[] {
    return Array.from(this.instances.keys()).filter(aid => this.instances.get(aid)!.isOnline);
  }
}
