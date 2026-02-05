/**
 * ACP 客户端 - 使用 acp-ts 库直接连接 ACP 网络
 * 支持心跳和消息接收
 */
import { AgentManager, HeartbeatClient } from "acp-ts";
import type { AcpSession } from "./types.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "error";

export interface AcpClientOptions {
  agentName: string;
  domain: string;
  seedPassword?: string;
  onMessage: (sender: string, sessionId: string, identifyingCode: string, content: string) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: Error) => void;
}

export class AcpClient {
  private options: AcpClientOptions;
  private manager: ReturnType<typeof AgentManager.getInstance>;
  private heartbeat: HeartbeatClient | null = null;
  private aid: string = "";
  private isOnline: boolean = false;

  // 会话管理
  private sessions: Map<string, AcpSession> = new Map();  // targetAid -> session
  private sessionsBySessionId: Map<string, AcpSession> = new Map();  // sessionId -> session

  constructor(options: AcpClientOptions) {
    this.options = options;
    this.manager = AgentManager.getInstance();
    this.aid = `${options.agentName}.${options.domain}`;
  }

  /**
   * 连接到 ACP 网络
   */
  async connect(): Promise<void> {
    console.log(`[ACP-TS] Connecting as ${this.aid}...`);
    this.options.onStatusChange?.("connecting");

    try {
      // 1. 初始化 AgentCP
      const acp = this.manager.initACP(this.options.domain, this.options.seedPassword || "");

      // 2. 先尝试加载已有 AID，如果不存在再创建
      let loadedAid = await acp.loadAid(this.aid);
      if (!loadedAid) {
        console.log(`[ACP-TS] AID not found locally, creating new...`);
        loadedAid = await acp.createAid(this.aid);
      }
      console.log(`[ACP-TS] AID loaded/created: ${loadedAid}`);

      // 3. 上线获取连接配置
      const config = await acp.online();
      console.log(`[ACP-TS] Online config received:`);
      console.log(`  - messageServer: ${config.messageServer}`);
      console.log(`  - heartbeatServer: ${config.heartbeatServer}`);

      // 4. 初始化 WebSocket 连接
      const aws = this.manager.initAWS(this.aid, config);

      // 5. 注册状态变更回调
      aws.onStatusChange((status) => {
        console.log(`[ACP-TS] WebSocket status: ${status}`);
        this.isOnline = status === "connected";
        this.options.onStatusChange?.(status);
      });

      // 6. 注册消息接收回调
      console.log("[ACP-TS] Registering message callback...");
      aws.onMessage((message) => {
        console.log("[ACP-TS] >>> onMessage callback triggered <<<");
        this.handleIncomingMessage(message);
      });

      // 7. 启动 WebSocket 连接
      console.log("[ACP-TS] Starting WebSocket connection...");
      await aws.startWebSocket();
      console.log("[ACP-TS] WebSocket connected");

      // 8. 启动心跳客户端（用于接收邀请通知）
      if (config.heartbeatServer) {
        console.log("[ACP-TS] Starting heartbeat client...");
        this.heartbeat = new HeartbeatClient(
          this.aid,
          config.heartbeatServer,
          this.options.seedPassword || ""
        );

        // 心跳状态回调
        this.heartbeat.onStatusChange((status) => {
          console.log(`[ACP-TS] Heartbeat status: ${status}`);
        });

        // 收到邀请时，通过 WebSocket 加入会话
        this.heartbeat.onInvite((invite) => {
          console.log(`[ACP-TS] Received invite from ${invite.inviterAgentId}, session: ${invite.sessionId}`);
          // 使用类型断言，因为接口定义缺少此方法
          (aws as any).acceptInviteFromHeartbeat(invite.sessionId, invite.inviterAgentId, invite.inviteCode);
        });

        // 启动心跳
        await this.heartbeat.online();
        console.log("[ACP-TS] Heartbeat client started");
      }

      this.isOnline = true;
      console.log(`[ACP-TS] Connected successfully as ${this.aid}`);
      this.options.onStatusChange?.("connected");

    } catch (error) {
      console.error("[ACP-TS] Connection failed:", error);
      this.options.onStatusChange?.("error");
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 处理收到的消息
   */
  private handleIncomingMessage(message: any): void {
    try {
      console.log("[ACP-TS] Raw message:", JSON.stringify(message).substring(0, 300));

      // acp-ts 的消息格式：整个 message 对象，包含 cmd 和 data
      const data = message.data || message;
      const sender = data.sender;
      const sessionId = data.session_id;
      const identifyingCode = data.identifying_code || "";

      // 忽略自己发的消息
      if (sender === this.aid) {
        console.log("[ACP-TS] Ignoring own message");
        return;
      }

      // 解析消息内容
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
      } catch (e) {
        console.warn("[ACP-TS] Failed to parse message content:", e);
        content = String(data.message || message);
      }

      if (!content) {
        console.log("[ACP-TS] Empty message content, ignoring");
        return;
      }

      console.log(`[ACP-TS] Message from ${sender}: ${content.substring(0, 50)}...`);

      // 查找或创建会话记录
      let session = this.sessionsBySessionId.get(sessionId);
      if (!session) {
        session = {
          sessionId,
          identifyingCode: identifyingCode,
          targetAid: sender,
          createdAt: Date.now(),
        };
        this.sessions.set(sender, session);
        this.sessionsBySessionId.set(sessionId, session);
      } else if (!session.identifyingCode && identifyingCode) {
        // 更新 identifyingCode
        session.identifyingCode = identifyingCode;
      }

      // 回调处理消息
      this.options.onMessage(sender, sessionId, session.identifyingCode, content);

    } catch (error) {
      console.error("[ACP-TS] Error handling message:", error);
    }
  }

  /**
   * 发送消息到指定 AID
   */
  async sendMessage(targetAid: string, content: string): Promise<void> {
    if (!this.isOnline) {
      throw new Error("ACP client not connected");
    }

    // 清理 target
    let cleanTarget = targetAid.replace(/^acp:/, "").trim();
    cleanTarget = cleanTarget.replace(/^g-/, "").trim();

    if (cleanTarget === this.aid) {
      console.warn("[ACP-TS] Preventing self-message loop");
      return;
    }

    console.log(`[ACP-TS] Sending message to ${cleanTarget}: ${content.substring(0, 50)}...`);

    const aws = this.manager.aws();

    // 检查是否已有会话
    const existingSession = this.sessions.get(cleanTarget);
    if (existingSession && existingSession.identifyingCode) {
      console.log(`[ACP-TS] Using existing session ${existingSession.sessionId.substring(0, 8)}...`);
      aws.send(content, cleanTarget, existingSession.sessionId, existingSession.identifyingCode);
      return;
    }

    console.log(`[ACP-TS] Creating new session to ${cleanTarget}`);

    // 保存待发送的消息，等邀请成功后再发送
    const pendingContent = content;

    aws.connectTo(
      cleanTarget,
      (sessionInfo) => {
        console.log(`[ACP-TS] Session created: ${sessionInfo.sessionId.substring(0, 8)}...`);

        const newSession: AcpSession = {
          sessionId: sessionInfo.sessionId,
          identifyingCode: sessionInfo.identifyingCode,
          targetAid: cleanTarget,
          createdAt: Date.now(),
        };
        this.sessions.set(cleanTarget, newSession);
        this.sessionsBySessionId.set(sessionInfo.sessionId, newSession);

        // 不在这里发送，等邀请成功后再发送
      },
      (inviteStatus) => {
        console.log(`[ACP-TS] Invite status: ${inviteStatus}`);
        if (inviteStatus === "success") {
          // 邀请成功后发送消息
          const session = this.sessions.get(cleanTarget);
          if (session) {
            console.log(`[ACP-TS] Invite success, now sending message...`);
            aws.send(pendingContent, cleanTarget, session.sessionId, session.identifyingCode);
          }
        } else {
          console.error(`[ACP-TS] Failed to invite ${cleanTarget} - target may be offline`);
        }
      }
    );
  }

  /**
   * 回复消息
   */
  async sendReply(sessionId: string, content: string): Promise<void> {
    if (!this.isOnline) {
      throw new Error("ACP client not connected");
    }

    const session = this.sessionsBySessionId.get(sessionId);
    if (!session) {
      console.warn(`[ACP-TS] No session found for ${sessionId}`);
      return;
    }

    console.log(`[ACP-TS] Replying in session ${sessionId.substring(0, 8)}... to ${session.targetAid}`);

    const aws = this.manager.aws();

    if (session.identifyingCode) {
      aws.send(content, session.targetAid, sessionId, session.identifyingCode);
    } else {
      console.log(`[ACP-TS] No identifyingCode, creating new session`);
      await this.sendMessage(session.targetAid, content);
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    console.log("[ACP-TS] Disconnecting...");
    try {
      this.manager.aws().disconnect();
    } catch (e) {
      // ignore
    }
    if (this.heartbeat) {
      this.heartbeat.offline();
      this.heartbeat = null;
    }
    this.isOnline = false;
    this.sessions.clear();
    this.sessionsBySessionId.clear();
    this.options.onStatusChange?.("disconnected");
  }

  get connected(): boolean {
    return this.isOnline;
  }

  get fullAid(): string {
    return this.aid;
  }
}
