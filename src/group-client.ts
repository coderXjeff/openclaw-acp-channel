/**
 * 群组客户端生命周期管理
 * 负责初始化/关闭群组客户端，以及获取 GroupOperations / AgentCP 实例
 *
 * 每个 AID 拥有独立的 AgentCP 实例（存储在 AcpMultiClient 中），
 * 通过 multiClient.getAgentCP(aid) / multiClient.getAgentWS(aid) 获取，
 * 不再依赖 AgentManager 全局单例。
 */
import { LocalCursorStore } from "acp-ts";
import type { ACPGroupEventHandler } from "acp-ts";
import type { AcpRuntimeState, GroupMessageBuffer, GroupMessageItem, GroupSocialConfig, GroupVitalityState, MentionInfo } from "./types.js";
import type { IdentityAcpState } from "./types.js"; // backward compat alias
import { DEFAULT_SESSION_CONFIG, DEFAULT_GROUP_SOCIAL_CONFIG } from "./types.js";
import type { AcpIdentityRouter } from "./identity-router.js";
import { loadAgentMdSources } from "./agent-md-sources.js";
import { parseIdentity } from "./agent-md-builder.js";
import { getWorkspaceDir } from "./workspace.js";
import { buildMentionKeywords, checkMention, pruneVitalityWindow, computeVitality, determineReplyType } from "./group-social.js";
import * as path from "path";
import * as fs from "fs";

const ACP_STORAGE_DIR = path.join(process.env.HOME || "~", ".acp-storage");
const DEBUG_LOG = "/tmp/acp-group-debug.log";
const PULL_PAGE_SIZE = 50;
const MAX_PULL_PAGES = 100;

function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] [group-client] ${msg}\n`;
  try { fs.appendFileSync(DEBUG_LOG, line); } catch {}
}

// ===== Helper functions =====

function getOrCreateBuffer(state: IdentityAcpState, groupId: string): GroupMessageBuffer {
  let buffer = state.groupMessageBuffers.get(groupId);
  if (!buffer) {
    buffer = {
      groupId,
      incomingMessages: [],
      bufferGateTimer: null,
      incomingBatchCount: 0,
      pendingQueue: [],
      pendingBatchCount: 0,
      cooldownTimer: null,
      dispatching: false,
      lastDispatchAt: 0,
      lastPulledMsgId: 0,
      pulling: false,
      seenMsgIds: new Set(),
      // P1 群活力 & 提及
      vitalityWindow: { events: [], windowMs: 300_000 },
      mentionKeywords: [],
      selfSendEvents: [],
      lastSelfSpeakAt: 0,
      hasPendingMention: false,
      lastNReplyHashes: [],
      mentionDelayTimer: null,
    };
    state.groupMessageBuffers.set(groupId, buffer);
  }
  return buffer;
}

/** Returns true if the message is new (not a duplicate) */
function deduplicateMessage(buffer: GroupMessageBuffer, msgId: number): boolean {
  if (msgId <= 0) return true; // no valid msg_id, can't dedup
  if (buffer.seenMsgIds.has(msgId)) return false;
  buffer.seenMsgIds.add(msgId);
  // 防止无限增长：超过 500 则裁剪到 300
  if (buffer.seenMsgIds.size > 500) {
    const sorted = Array.from(buffer.seenMsgIds).sort((a, b) => a - b);
    for (const id of sorted.slice(0, sorted.length - 300)) {
      buffer.seenMsgIds.delete(id);
    }
  }
  return true;
}

function getDispatchCooldownMs(router: AcpIdentityRouter): number {
  const acpConfig = router.getAcpConfig();
  const val = acpConfig?.session?.groupDispatchCooldownMs;
  return (typeof val === "number" && val >= 1000) ? val : DEFAULT_SESSION_CONFIG.groupDispatchCooldownMs;
}

function getBufferGateMs(router: AcpIdentityRouter): number {
  const acpConfig = router.getAcpConfig();
  const val = acpConfig?.session?.groupBufferGateMs;
  return (typeof val === "number" && val >= 500) ? val : DEFAULT_SESSION_CONFIG.groupBufferGateMs;
}

function getGroupSocialConfig(router: AcpIdentityRouter): Required<GroupSocialConfig> {
  const acpConfig = router.getAcpConfig();
  const userCfg = acpConfig?.groupSocial ?? {};
  return { ...DEFAULT_GROUP_SOCIAL_CONFIG, ...userCfg };
}

/**
 * 读取 identity 的展示名（例如 IDENTITY.md 的 Name），作为自动 mention 别名。
 * 失败时返回空数组，保持兼容。
 */
function loadIdentityDisplayAliases(state: IdentityAcpState, router: AcpIdentityRouter): string[] {
  const aliases: string[] = [];
  try {
    const acpConfig = router.getAcpConfig();
    const wsDir = state.account.workspaceDir || acpConfig?.workspaceDir || getWorkspaceDir(state.identityId);
    if (!wsDir) return aliases;
    const sources = loadAgentMdSources(wsDir, state.identityId);
    const identityMd = sources.identity;
    if (!identityMd) return aliases;
    const parsed = parseIdentity(identityMd);
    if (parsed.name && parsed.name.trim().length >= 2) {
      aliases.push(parsed.name.trim());
    }
  } catch {
    // best-effort alias loading; ignore failures
  }
  return aliases;
}

// ===== Buffer Gate =====

function feedBufferGate(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string,
  messages: GroupMessageItem[]
): void {
  const identityId = state.identityId;
  const buffer = getOrCreateBuffer(state, groupId);
  const socialCfg = getGroupSocialConfig(router);
  if (socialCfg.enabled) {
    buffer.vitalityWindow.windowMs = socialCfg.vitalityWindowMs;
  }

  let added = 0;
  for (const msg of messages) {
    if (!deduplicateMessage(buffer, msg.msg_id)) {
      debugLog(`[${identityId}] feedBufferGate DEDUP: skipping msg_id=${msg.msg_id} for group=${groupId}`);
      continue;
    }

    // P1: 滑窗事件追加 + 提及检测
    if (socialCfg.enabled) {
      buffer.vitalityWindow.events.push({ ts: msg.timestamp, sender: msg.sender });

      // 补填 mentionKeywords（若为空，从 identity 级缓存复制）
      if (buffer.mentionKeywords.length === 0 && (state as any)._mentionKeywords?.length > 0) {
        buffer.mentionKeywords = [...(state as any)._mentionKeywords];
      }

      if (checkMention(msg.content, buffer.mentionKeywords)) {
        msg.isMention = true;
      }
    }

    buffer.incomingMessages.push(msg);
    added++;
  }

  debugLog(`[${identityId}] feedBufferGate: group=${groupId}, received=${messages.length}, added=${added}, incomingSize=${buffer.incomingMessages.length}`);

  if (added === 0) return;
  buffer.incomingBatchCount += 1;

  // P1: 清理过期滑窗事件
  if (socialCfg.enabled) {
    pruneVitalityWindow(buffer.vitalityWindow, Date.now());
  }

  // P1: 提及加速路径
  if (socialCfg.enabled) {
    const hasMention = buffer.incomingMessages.some(m => m.isMention);
    if (hasMention) {
      debugLog(`[${identityId}] feedBufferGate: MENTION detected in group=${groupId}`);

      // 取消正常 bufferGateTimer
      if (buffer.bufferGateTimer) {
        clearTimeout(buffer.bufferGateTimer);
        buffer.bufferGateTimer = null;
      }
      if (buffer.cooldownTimer) {
        clearTimeout(buffer.cooldownTimer);
        buffer.cooldownTimer = null;
      }

      // 如果正在 dispatch，标记等待
      if (buffer.dispatching) {
        buffer.hasPendingMention = true;
        debugLog(`[${identityId}] feedBufferGate: dispatching=true, set hasPendingMention=true`);
        return;
      }

      // 检查 mentionMinIntervalMs 节流
      const elapsed = Date.now() - buffer.lastDispatchAt;
      const minInterval = socialCfg.mentionMinIntervalMs;
      if (buffer.lastDispatchAt > 0 && elapsed < minInterval) {
        const remaining = minInterval - elapsed;
        debugLog(`[${identityId}] feedBufferGate: mention throttle, remaining=${remaining}ms`);
        if (!buffer.mentionDelayTimer) {
          buffer.mentionDelayTimer = setTimeout(() => {
            buffer.mentionDelayTimer = null;
            mergeAndDispatch(state, router, groupId, buffer);
          }, remaining);
        }
        return;
      }

      // 立即合并提交
      mergeAndDispatch(state, router, groupId, buffer);
      return;
    }
  }

  // 正常路径：重置 bufferGateTimer
  if (buffer.bufferGateTimer) {
    clearTimeout(buffer.bufferGateTimer);
  }
  const gateMs = getBufferGateMs(router);
  buffer.bufferGateTimer = setTimeout(() => {
    buffer.bufferGateTimer = null;
    flushBufferGateToQueue(state, router, groupId);
  }, gateMs);
  debugLog(`[${identityId}] feedBufferGate: bufferGateTimer reset to ${gateMs}ms for group=${groupId}`);
}

/**
 * P1: 合并所有未处理消息并立即 dispatch（提及加速路径）
 */
function mergeAndDispatch(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string,
  buffer: GroupMessageBuffer
): void {
  const identityId = state.identityId;

  if (buffer.dispatching) {
    buffer.hasPendingMention = true;
    debugLog(`[${identityId}] mergeAndDispatch SKIP: dispatching=true, set hasPendingMention=true`);
    return;
  }

  // 取消所有定时器
  if (buffer.bufferGateTimer) { clearTimeout(buffer.bufferGateTimer); buffer.bufferGateTimer = null; }
  if (buffer.cooldownTimer) { clearTimeout(buffer.cooldownTimer); buffer.cooldownTimer = null; }
  if (buffer.mentionDelayTimer) { clearTimeout(buffer.mentionDelayTimer); buffer.mentionDelayTimer = null; }

  // 合并 incomingMessages + pendingQueue
  const merged = [...buffer.incomingMessages.splice(0), ...buffer.pendingQueue.splice(0)];
  merged.sort((a, b) => a.timestamp - b.timestamp);
  let batchesMerged = buffer.incomingBatchCount + buffer.pendingBatchCount;
  if (batchesMerged <= 0 && merged.length > 0) {
    batchesMerged = 1;
  }
  buffer.incomingBatchCount = 0;
  buffer.pendingBatchCount = 0;

  debugLog(`[${identityId}] mergeAndDispatch: group=${groupId}, merged=${merged.length} messages, batches=${batchesMerged}`);

  if (merged.length === 0) return;

  void dispatchToAgent(state, router, groupId, merged, buffer, {
    triggerType: "mention",
    batchesMerged,
  });
}

function flushBufferGateToQueue(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string
): void {
  const identityId = state.identityId;
  const buffer = state.groupMessageBuffers.get(groupId);
  if (!buffer || buffer.incomingMessages.length === 0) {
    debugLog(`[${identityId}] flushBufferGateToQueue SKIP: group=${groupId}, empty`);
    return;
  }

  const flushed = buffer.incomingMessages.splice(0);
  const incomingBatchCount = buffer.incomingBatchCount;
  buffer.incomingBatchCount = 0;
  buffer.pendingQueue.push(...flushed);
  if (flushed.length > 0) {
    buffer.pendingBatchCount += Math.max(1, incomingBatchCount);
  }
  debugLog(`[${identityId}] flushBufferGateToQueue: group=${groupId}, flushed=${flushed.length} to pendingQueue, queueSize=${buffer.pendingQueue.length}`);

  tryDispatch(state, router, groupId);
}

// ===== Dispatch Gate =====

function tryDispatch(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string
): void {
  const identityId = state.identityId;
  const buffer = state.groupMessageBuffers.get(groupId);
  if (!buffer || buffer.pendingQueue.length === 0) {
    debugLog(`[${identityId}] tryDispatch SKIP: group=${groupId}, no pending messages`);
    return;
  }

  if (buffer.dispatching) {
    debugLog(`[${identityId}] tryDispatch SKIP: group=${groupId}, already dispatching (messages stay in pendingQueue)`);
    return;
  }
  if (buffer.mentionDelayTimer) {
    debugLog(`[${identityId}] tryDispatch SKIP: group=${groupId}, mentionDelayTimer pending`);
    return;
  }

  const cooldownMs = getDispatchCooldownMs(router);
  const elapsed = Date.now() - buffer.lastDispatchAt;
  if (buffer.lastDispatchAt > 0 && elapsed < cooldownMs) {
    // 冷却未过，启动 cooldownTimer（如果尚未启动）
    if (!buffer.cooldownTimer) {
      const remaining = cooldownMs - elapsed;
      debugLog(`[${identityId}] tryDispatch COOLDOWN: group=${groupId}, remaining=${remaining}ms`);
      buffer.cooldownTimer = setTimeout(() => {
        buffer.cooldownTimer = null;
        tryDispatch(state, router, groupId);
      }, remaining);
    }
    return;
  }

  // 取出 pendingQueue 全部消息
  const messages = buffer.pendingQueue.splice(0);
  const batchesMerged = buffer.pendingBatchCount > 0 ? buffer.pendingBatchCount : 1;
  buffer.pendingBatchCount = 0;
  debugLog(`[${identityId}] tryDispatch GO: group=${groupId}, dispatching ${messages.length} messages`);
  void dispatchToAgent(state, router, groupId, messages, buffer, {
    triggerType: "normal",
    batchesMerged,
  });
}

async function dispatchToAgent(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string,
  messages: GroupMessageItem[],
  buffer: GroupMessageBuffer,
  dispatchMeta: {
    triggerType: "normal" | "mention";
    batchesMerged: number;
  } = { triggerType: "normal", batchesMerged: 1 }
): Promise<void> {
  const identityId = state.identityId;
  buffer.dispatching = true;

  debugLog(`[${identityId}] dispatchToAgent START: group=${groupId}, messageCount=${messages.length}`);
  console.log(`[ACP-Group] [${identityId}] Dispatching ${messages.length} group messages for group=${groupId}`);

  try {
    const { handleGroupMessagesForIdentity } = await import("./monitor.js");
    // 转换为 handleGroupMessagesForIdentity 期望的格式
    const formatted = messages.map(m => ({
      sender: m.sender,
      content: m.content,
      timestamp: m.timestamp,
      msg_id: m.msg_id > 0 ? m.msg_id : undefined,
      isMention: m.isMention,
    }));

    const socialCfg = getGroupSocialConfig(router);

    if (socialCfg.enabled) {
      // P1: 计算活力状态
      const vitality = computeVitality(buffer.vitalityWindow, buffer.selfSendEvents);
      debugLog(`[${identityId}] computeVitality: state=${vitality.state}, msgs=${vitality.messagesIn5m}, speakers=${vitality.uniqueSpeakersIn5m}, myMsgs=${vitality.myMessagesIn5m}`);

      // P1: 构建 mentionInfo
      const mentionCount = messages.filter(m => m.isMention).length;
      const mentionInfo: MentionInfo = {
        mentioned: mentionCount > 0,
        mentionCount,
        batchesMerged: Math.max(1, dispatchMeta.batchesMerged),
        triggerType: dispatchMeta.triggerType,
      };

      // P1: 决定回复类型
      const replyType = determineReplyType(vitality, mentionInfo.mentioned);
      debugLog(`[${identityId}] replyType=${replyType}, mentioned=${mentionInfo.mentioned}`);

      await handleGroupMessagesForIdentity(state, groupId, formatted, {
        vitality,
        mentionInfo,
        replyType,
        groupSocialConfig: socialCfg,
        lastSelfSpeakAt: buffer.lastSelfSpeakAt,
        onSelfSend: (ts: number) => {
          buffer.selfSendEvents.push({ ts });
          buffer.lastSelfSpeakAt = ts;
        },
      });
    } else {
      await handleGroupMessagesForIdentity(state, groupId, formatted);
    }

    debugLog(`[${identityId}] dispatchToAgent DONE: group=${groupId}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    debugLog(`[${identityId}] dispatchToAgent ERROR: group=${groupId}, error=${errMsg}\n${errStack ?? ''}`);
    console.error(`[ACP-Group] [${identityId}] Error dispatching group messages:`, err);
  } finally {
    buffer.dispatching = false;
    buffer.lastDispatchAt = Date.now();
    debugLog(`[${identityId}] dispatchToAgent FINALLY: group=${groupId}, dispatching=false, lastDispatchAt=${buffer.lastDispatchAt}`);

    // P1 修复：flush dispatch 期间积压的 incomingMessages
    if (buffer.incomingMessages.length > 0) {
      if (buffer.bufferGateTimer) { clearTimeout(buffer.bufferGateTimer); buffer.bufferGateTimer = null; }
      buffer.pendingQueue.push(...buffer.incomingMessages.splice(0));
      buffer.pendingBatchCount += Math.max(1, buffer.incomingBatchCount);
      buffer.incomingBatchCount = 0;
    }

    // P1: 若有积压的提及消息，走加速路径
    const socialCfg = getGroupSocialConfig(router);
    if (socialCfg.enabled && buffer.hasPendingMention && buffer.pendingQueue.length > 0) {
      buffer.hasPendingMention = false;
      if (buffer.cooldownTimer) {
        clearTimeout(buffer.cooldownTimer);
        buffer.cooldownTimer = null;
      }
      const elapsed = Date.now() - buffer.lastDispatchAt;
      const minInterval = socialCfg.mentionMinIntervalMs;
      if (elapsed >= minInterval) {
        mergeAndDispatch(state, router, groupId, buffer);
      } else {
        const remaining = minInterval - elapsed;
        if (!buffer.mentionDelayTimer) {
          buffer.mentionDelayTimer = setTimeout(() => {
            buffer.mentionDelayTimer = null;
            mergeAndDispatch(state, router, groupId, buffer);
          }, remaining);
        }
      }
    }
    // 否则走原有冷却路径
    else if (buffer.pendingQueue.length > 0 && !buffer.cooldownTimer && !buffer.mentionDelayTimer) {
      const cooldownMs = getDispatchCooldownMs(router);
      debugLog(`[${identityId}] dispatchToAgent: pendingQueue has ${buffer.pendingQueue.length} msgs, starting cooldown ${cooldownMs}ms`);
      buffer.cooldownTimer = setTimeout(() => {
        buffer.cooldownTimer = null;
        tryDispatch(state, router, groupId);
      }, cooldownMs);
    }
  }
}

/**
 * 连接成功后初始化群组客户端
 */
export async function initGroupClientForIdentity(
  state: IdentityAcpState,
  router: AcpIdentityRouter
): Promise<void> {
  const aid = state.aidKey;
  const domain = state.account.domain;
  const groupTargetAid = `group.${domain}`;
  const identityId = state.identityId;

  debugLog(`[${identityId}] === initGroupClientForIdentity START === aid=${aid}, target=${groupTargetAid}`);
  console.log(`[ACP-Group] [${identityId}] Initializing group client for ${aid}, target: ${groupTargetAid}`);

  // 获取该 AID 独立的 AgentWS 实例
  const agentWS = router.multiClient.getAgentWS(aid);
  if (!agentWS) {
    debugLog(`[${identityId}] FAIL: AgentWS not found for ${aid}`);
    console.error(`[ACP-Group] [${identityId}] AgentWS not found for ${aid}`);
    throw new Error(`AgentWS not available for ${aid}`);
  }
  debugLog(`[${identityId}] AgentWS obtained OK, connecting to ${groupTargetAid}...`);
  console.log(`[ACP-Group] [${identityId}] AgentWS obtained, connecting to ${groupTargetAid}...`);

  // 建立与 group.{domain} 的会话
  const sessionId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      debugLog(`[${identityId}] FAIL: Session invite to ${groupTargetAid} timed out after 30s`);
      console.error(`[ACP-Group] [${identityId}] Session invite to ${groupTargetAid} timed out after 30s`);
      reject(new Error(`Group session invite to ${groupTargetAid} timed out`));
    }, 30_000);

    let pendingSessionId: string | null = null;

    debugLog(`[${identityId}] Calling agentWS.connectTo(${groupTargetAid})...`);
    agentWS.connectTo(
      groupTargetAid,
      (sessionInfo: any) => {
        pendingSessionId = sessionInfo.sessionId;
        debugLog(`[${identityId}] Session created: ${pendingSessionId}, waiting for invite confirmation...`);
        console.log(`[ACP-Group] [${identityId}] Session created: ${pendingSessionId}, waiting for invite confirmation...`);
      },
      (inviteStatus: any) => {
        clearTimeout(timer);
        debugLog(`[${identityId}] Invite callback: status=${inviteStatus}, sessionId=${pendingSessionId}`);
        console.log(`[ACP-Group] [${identityId}] Invite status: ${inviteStatus}, sessionId: ${pendingSessionId}`);
        if (inviteStatus === "success" && pendingSessionId) {
          resolve(pendingSessionId);
        } else {
          debugLog(`[${identityId}] FAIL: Invite failed with status=${inviteStatus}`);
          reject(new Error(`Group session invite to ${groupTargetAid} failed: ${inviteStatus}`));
        }
      }
    );
  });

  debugLog(`[${identityId}] Session established: ${sessionId}`);

  // 获取该 AID 独立的 AgentCP 实例
  const acp = router.multiClient.getAgentCP(aid);
  if (!acp) {
    debugLog(`[${identityId}] FAIL: AgentCP instance not available for ${aid}`);
    console.error(`[ACP-Group] [${identityId}] AgentCP instance not available for ${aid}`);
    throw new Error(`AgentCP instance not available for ${aid}`);
  }
  debugLog(`[${identityId}] AgentCP instance obtained, calling initGroupClient...`);
  console.log(`[ACP-Group] [${identityId}] AgentCP instance obtained, initializing group client...`);

  // 初始化群组客户端
  const sendRaw = (message: string, to: string, sid: string) => {
    console.log(`[ACP-Group] [${identityId}] sendRaw: to=${to}, sid=${sid}, len=${message.length}`);
    agentWS.sendRaw(message, to, sid);
  };
  acp.initGroupClient(sendRaw, sessionId, groupTargetAid);
  // 验证 initGroupClient 是否正确设置了内部状态
  const internalGroupClient = (acp as any).groupClient;
  const internalGroupTargetAid = (acp as any)._groupTargetAid;
  debugLog(`[${identityId}] initGroupClient called OK, session=${sessionId}, target=${groupTargetAid}`);
  debugLog(`[${identityId}] POST-INIT verification: groupClient=${internalGroupClient != null ? "SET" : "NULL"}, _groupTargetAid="${internalGroupTargetAid ?? "NULL"}"`);
  console.log(`[ACP-Group] [${identityId}] Group client initialized with session=${sessionId}, target=${groupTargetAid}`);
  if (!internalGroupClient) {
    debugLog(`[${identityId}] CRITICAL: groupClient is NULL after initGroupClient! SDK may not have set it.`);
    console.error(`[ACP-Group] [${identityId}] CRITICAL: groupClient is NULL after initGroupClient!`);
  }
  if (internalGroupTargetAid !== groupTargetAid) {
    debugLog(`[${identityId}] CRITICAL: _groupTargetAid mismatch! expected="${groupTargetAid}", actual="${internalGroupTargetAid}"`);
    console.error(`[ACP-Group] [${identityId}] CRITICAL: _groupTargetAid mismatch after initGroupClient!`);
  }

  // 设置游标存储
  const cursorPath = path.join(ACP_STORAGE_DIR, "AIDs", aid, "group-cursors.json");
  console.log(`[ACP-Group] [${identityId}] Cursor store path: ${cursorPath}`);
  const cursorStore = new LocalCursorStore(cursorPath);
  acp.setGroupCursorStore(cursorStore);

  // 初始化群消息持久化存储
  await acp.initGroupMessageStore();
  debugLog(`[${identityId}] Group message store initialized OK`);
  console.log(`[ACP-Group] [${identityId}] Group message store initialized`);

  // 设置事件处理器
  const eventHandler: ACPGroupEventHandler = {
    onNewMessage(groupId, latestMsgId, sender, preview) {
      debugLog(`[${identityId}] EVENT onNewMessage: group=${groupId}, msgId=${latestMsgId}, sender=${sender}, preview=${preview.substring(0, 80)}`);
      // new_message 只是通知，需要主动 pullMessages 拉取完整消息内容（fallback 路径）
      void pullAndBufferGroupMessages(state, router, groupId);
    },
    onNewEvent(groupId, _latestEventId, eventType, summary) {
      debugLog(`[${identityId}] EVENT onNewEvent: group=${groupId}, type=${eventType}, summary=${summary}`);
      console.log(`[ACP-Group] [${identityId}] Event in ${groupId}: ${eventType} - ${summary}`);
    },
    onGroupInvite(groupId, _groupAddress, invitedBy) {
      debugLog(`[${identityId}] EVENT onGroupInvite: group=${groupId}, invitedBy=${invitedBy}`);
      console.log(`[ACP-Group] [${identityId}] Invited to ${groupId} by ${invitedBy}`);
    },
    onJoinApproved(groupId, _groupAddress) {
      debugLog(`[${identityId}] EVENT onJoinApproved: group=${groupId}`);
      console.log(`[ACP-Group] [${identityId}] Join approved for ${groupId}`);
    },
    onJoinRejected(groupId, reason) {
      debugLog(`[${identityId}] EVENT onJoinRejected: group=${groupId}, reason=${reason}`);
      console.log(`[ACP-Group] [${identityId}] Join rejected for ${groupId}: ${reason}`);
    },
    onJoinRequestReceived(groupId, agentId, message) {
      debugLog(`[${identityId}] EVENT onJoinRequestReceived: group=${groupId}, agent=${agentId}, msg=${message}`);
      console.log(`[ACP-Group] [${identityId}] Join request for ${groupId} from ${agentId}: ${message}`);
    },
    onGroupMessageBatch(groupId, batch) {
      debugLog(`[${identityId}] onGroupMessageBatch: group=${groupId}, count=${batch.count}, msgRange=${batch.start_msg_id}-${batch.latest_msg_id}`);

      // 排序/存储/ACK（SDK 要求调用方处理）
      try {
        acp.processAndAckBatch(groupId, batch);
        debugLog(`[${identityId}] processAndAckBatch OK: group=${groupId}`);
      } catch (err) {
        debugLog(`[${identityId}] processAndAckBatch ERROR: ${err instanceof Error ? err.message : String(err)}`);
      }

      // 过滤自己发的消息
      const items: GroupMessageItem[] = [];
      for (const msg of batch.messages) {
        const sender = msg.sender ?? "";
        if (sender === aid) continue;
        items.push({
          msg_id: msg.msg_id ?? 0,
          sender,
          content: String(msg.content ?? ""),
          timestamp: msg.timestamp ?? Date.now(),
        });
      }

      debugLog(`[${identityId}] onGroupMessageBatch: group=${groupId}, after self-filter=${items.length}/${batch.messages.length}`);
      if (items.length > 0) {
        feedBufferGate(state, router, groupId, items);
      }
    },
    onGroupEvent(_groupId, _evt) {},
  };
  acp.setGroupEventHandler(eventHandler);
  debugLog(`[${identityId}] setGroupEventHandler called OK. Verifying: handler=${(internalGroupClient as any)?._handler != null ? "SET" : "NULL"}`);

  // 设置原始消息拦截器（群组消息路由）
  agentWS.onRawMessage((msg: any) => {
    try {
      const msgSender = msg?.data?.sender ?? msg?.sender ?? "<no sender>";
      const msgCmd = msg?.cmd ?? msg?.data?.cmd ?? "<no cmd>";
      const msgSessionId = msg?.data?.sessionId ?? msg?.sessionId ?? "<no sessionId>";

      debugLog(`[${identityId}] onRawMessage: cmd=${msgCmd}, sender=${msgSender}, sessionId=${msgSessionId}`);
      debugLog(`[${identityId}] >>> onRawMessage: expected groupTargetAid="${groupTargetAid}", actual sender="${msgSender}", match=${msgSender === groupTargetAid}`);

      const handled = acp.handleGroupMessage(msg);

      if (handled) {
        debugLog(`[${identityId}] onRawMessage handled`);
      } else {
        debugLog(`[${identityId}] onRawMessage NOT handled: sender="${msgSender}" target="${groupTargetAid}"`);
      }
      return handled;
    } catch (err) {
      debugLog(`[${identityId}] ERROR handling raw group message: ${err instanceof Error ? err.message : String(err)}\n${err instanceof Error ? err.stack : ""}`);
      console.error(`[ACP-Group] [${identityId}] Error handling raw group message:`, err instanceof Error ? err.message : String(err));
      return false;
    }
  });

  // 更新 state
  state.groupClientReady = true;
  state.groupSessionId = sessionId;
  state.groupTargetAid = groupTargetAid;

  // P1: 构建提及关键词
  const acpConfig = router.getAcpConfig();
  if (acpConfig?.groupSocial?.enabled) {
    const extraAliases = loadIdentityDisplayAliases(state, router);
    const keywords = buildMentionKeywords(state.account, acpConfig, extraAliases);
    (state as any)._mentionKeywords = keywords;
    debugLog(`[${identityId}] P1 mentionKeywords: [${keywords.join(', ')}]`);
  }

  // 注册上线 + 心跳保活
  void (async () => {
    try {
      const acpInstance = router.multiClient.getAgentCP(aid);
      if (!acpInstance) return;

      const ops = acpInstance.groupOps;
      if (!ops) {
        debugLog(`[${identityId}] registerOnline SKIP: groupOps not available`);
        return;
      }

      // 注册上线，告知 group.ap 当前客户端在线
      await ops.registerOnline(groupTargetAid);
      debugLog(`[${identityId}] registerOnline OK: target=${groupTargetAid}`);

      // 同步群列表
      const groups = await acpInstance.syncGroupList();
      debugLog(`[${identityId}] Post-init syncGroupList OK: ${groups.length} groups`);

      // 心跳保活：每 3 分钟发一次（在线注册 5 分钟超时）
      const heartbeatInterval = setInterval(async () => {
        try {
          if (!state.groupClientReady) {
            clearInterval(heartbeatInterval);
            return;
          }
          await ops.heartbeat(groupTargetAid);
          debugLog(`[${identityId}] heartbeat OK`);
        } catch (err) {
          debugLog(`[${identityId}] heartbeat FAIL: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 3 * 60 * 1000);
      (state as any)._groupHeartbeatInterval = heartbeatInterval;
    } catch (err) {
      debugLog(`[${identityId}] registerOnline error: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  debugLog(`[${identityId}] === initGroupClientForIdentity DONE ===`);
  debugLog(`[${identityId}]   groupClientReady = ${state.groupClientReady}`);
  debugLog(`[${identityId}]   groupSessionId   = ${state.groupSessionId}`);
  debugLog(`[${identityId}]   groupTargetAid   = ${state.groupTargetAid}`);
  debugLog(`[${identityId}]   acp.groupClient  = ${(acp as any).groupClient != null ? "SET" : "NULL"}`);
  debugLog(`[${identityId}]   acp._groupTargetAid = ${(acp as any)._groupTargetAid ?? "NULL"}`);
  debugLog(`[${identityId}]   acp._handler     = ${(acp as any).groupClient?._handler != null ? "SET" : "NULL"}`);
  debugLog(`[${identityId}]   onRawMessage     = registered`);
  debugLog(`[${identityId}]   All 8 event callbacks = registered`);
  console.log(`[ACP-Group] [${identityId}] Group client fully initialized (session: ${sessionId}, target: ${groupTargetAid})`);
}

/**
 * 断开/停止时清理群组客户端
 * 每个 AID 拥有独立的 AgentCP，closeGroupClient() 只影响自己。
 */
export async function closeGroupClientForIdentity(
  state: IdentityAcpState,
  router?: AcpIdentityRouter
): Promise<void> {
  if (!state.groupClientReady) return;

  const identityId = state.identityId;
  debugLog(`[${identityId}] Closing group client`);
  console.log(`[ACP-Group] [${identityId}] Closing group client`);

  // 安全调用该 AID 自己的 closeGroupClient（独立实例，不影响其他身份）
  const r = router ?? getRouterSafe();
  if (r) {
    const acp = r.multiClient.getAgentCP(state.aidKey);
    if (!acp) {
      debugLog(`[${identityId}] closeGroupClient SKIP: AgentCP not found for ${state.aidKey}`);
    } else {
      // 下线通知
      try {
        const ops = acp.groupOps;
        if (ops && state.groupTargetAid) {
          await ops.unregisterOnline(state.groupTargetAid);
          debugLog(`[${identityId}] unregisterOnline OK`);
        }
      } catch (err) {
        debugLog(`[${identityId}] unregisterOnline error: ${err instanceof Error ? err.message : String(err)}`);
      }
      try {
        acp.closeGroupClient();
      } catch (err) {
        debugLog(`[${identityId}] Error closing group client: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    debugLog(`[${identityId}] closeGroupClient SKIP: router unavailable`);
  }

  // 清理心跳定时器
  if ((state as any)._groupHeartbeatInterval) {
    clearInterval((state as any)._groupHeartbeatInterval);
    (state as any)._groupHeartbeatInterval = null;
  }

  // 清理群消息缓冲区和定时器
  for (const [, buffer] of state.groupMessageBuffers) {
    if (buffer.bufferGateTimer) {
      clearTimeout(buffer.bufferGateTimer);
      buffer.bufferGateTimer = null;
    }
    if (buffer.cooldownTimer) {
      clearTimeout(buffer.cooldownTimer);
      buffer.cooldownTimer = null;
    }
    if (buffer.mentionDelayTimer) {
      clearTimeout(buffer.mentionDelayTimer);
      buffer.mentionDelayTimer = null;
    }
  }
  state.groupMessageBuffers.clear();

  state.groupClientReady = false;
  state.groupSessionId = null;
  state.groupTargetAid = null;
}

/**
 * 收到 onNewMessage 通知后，主动 pullMessages 拉取完整消息，再喂给 buffer
 */
export async function pullAndBufferGroupMessages(
  state: IdentityAcpState,
  router: AcpIdentityRouter,
  groupId: string
): Promise<void> {
  const identityId = state.identityId;
  const aid = state.aidKey;
  const groupTargetAid = state.groupTargetAid;

  if (!groupTargetAid) {
    debugLog(`[${identityId}] pullAndBuffer SKIP: no groupTargetAid`);
    return;
  }

  // 获取或创建 buffer（用于跟踪 lastPulledMsgId 和 pulling 状态）
  const buffer = getOrCreateBuffer(state, groupId);

  if (buffer.pulling) {
    debugLog(`[${identityId}] pullAndBuffer SKIP: already pulling for group=${groupId}`);
    return;
  }
  buffer.pulling = true;

  try {
    const groupOps = getGroupOps(state, router);
    if (!groupOps) {
      debugLog(`[${identityId}] pullAndBuffer SKIP: groupOps not available`);
      return;
    }

    let afterMsgId = buffer.lastPulledMsgId;
    let maxMsgId = afterMsgId;
    let page = 0;
    let totalPulled = 0;
    let hasMore = false;
    const collectedMessages: GroupMessageItem[] = [];

    do {
      page++;
      if (page > MAX_PULL_PAGES) {
        debugLog(`[${identityId}] pullAndBuffer STOP: exceeded max pages (${MAX_PULL_PAGES}) for group=${groupId}`);
        break;
      }

      debugLog(`[${identityId}] pullAndBuffer: pulling page=${page} for group=${groupId}, afterMsgId=${afterMsgId}`);
      const result = await groupOps.pullMessages(groupTargetAid, groupId, afterMsgId, PULL_PAGE_SIZE);
      const msgs = result.messages ?? [];
      hasMore = !!result.has_more;
      totalPulled += msgs.length;
      debugLog(`[${identityId}] pullAndBuffer: page=${page}, pulled=${msgs.length}, has_more=${result.has_more}, latest_msg_id=${result.latest_msg_id}`);

      if (msgs.length === 0) {
        if (hasMore) {
          debugLog(`[${identityId}] pullAndBuffer WARNING: has_more=true but empty page for group=${groupId}, stopping to avoid loop`);
        } else {
          debugLog(`[${identityId}] pullAndBuffer: no new messages`);
        }
        break;
      }

      for (const m of msgs) {
        const msgId = m.msg_id ?? 0;
        if (msgId > maxMsgId) maxMsgId = msgId;

        const sender = m.sender ?? "";
        const content = m.content ?? "";
        const timestamp = m.timestamp ?? Date.now();

        debugLog(`[${identityId}] pullAndBuffer: msg_id=${msgId}, sender=${sender}, content="${String(content).substring(0, 80)}", ts=${timestamp}`);

        // 跳过自己发的消息（避免回声）
        if (sender === aid) {
          debugLog(`[${identityId}] pullAndBuffer: skipping self-sent message msg_id=${msgId}`);
          continue;
        }

        collectedMessages.push({ msg_id: msgId, sender, content: String(content), timestamp });
      }

      afterMsgId = maxMsgId;
    } while (hasMore);

    buffer.lastPulledMsgId = maxMsgId;
    debugLog(`[${identityId}] pullAndBuffer DONE: group=${groupId}, totalPulled=${totalPulled}, collected=${collectedMessages.length}, pages=${page}, lastPulledMsgId=${maxMsgId}`);

    // 一次性喂给 feedBufferGate
    if (collectedMessages.length > 0) {
      feedBufferGate(state, router, groupId, collectedMessages);
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    debugLog(`[${identityId}] pullAndBuffer ERROR: group=${groupId}, error=${errMsg}\n${errStack ?? ''}`);
    console.error(`[ACP-Group] [${identityId}] Error pulling group messages:`, err);
  } finally {
    buffer.pulling = false;
  }
}

/**
 * 获取 GroupOperations 实例（从该 AID 独立的 AgentCP 取）
 */
export function getGroupOps(state: IdentityAcpState, router?: AcpIdentityRouter) {
  if (!state.groupClientReady) {
    debugLog(`getGroupOps: groupClientReady=false for ${state.identityId}`);
    return null;
  }
  const r = router ?? getRouterSafe();
  if (!r) {
    debugLog(`getGroupOps: router not available for ${state.identityId}`);
    return null;
  }
  const acp = r.multiClient.getAgentCP(state.aidKey);
  const ops = acp?.groupOps ?? null;
  if (!ops) {
    debugLog(`getGroupOps: groupOps is null for ${state.identityId}`);
  } else {
    debugLog(`getGroupOps: OK for ${state.identityId}`);
  }
  return ops;
}

/**
 * 获取 AgentCP 实例（从该 AID 独立的 AgentCP 取）
 */
export function getGroupAcp(state: IdentityAcpState, router?: AcpIdentityRouter) {
  if (!state.groupClientReady) {
    debugLog(`getGroupAcp: groupClientReady=false for ${state.identityId}`);
    return null;
  }
  const r = router ?? getRouterSafe();
  if (!r) {
    debugLog(`getGroupAcp: router not available for ${state.identityId}`);
    return null;
  }
  const acp = r.multiClient.getAgentCP(state.aidKey);
  debugLog(`getGroupAcp: ${acp ? "OK" : "null"} for ${state.identityId}`);
  return acp ?? null;
}

/**
 * 安全获取 router（避免循环依赖）
 */
function getRouterSafe(): AcpIdentityRouter | null {
  try {
    const { getRouter } = require("./identity-router.js");
    return getRouter();
  } catch {
    return null;
  }
}
