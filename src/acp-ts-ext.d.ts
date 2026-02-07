/**
 * acp-ts 模块类型增补
 * 补充 acp-ts 类型定义中缺失的方法，避免使用 `as any` 绕过类型检查。
 */
declare module "acp-ts" {
  interface AgentWS {
    /** 通过心跳邀请加入会话（类型定义缺失，运行时存在） */
    acceptInviteFromHeartbeat(
      sessionId: string,
      inviterAgentId: string,
      inviteCode: string
    ): void;
  }
}
