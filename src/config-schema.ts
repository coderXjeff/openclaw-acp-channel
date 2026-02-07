import { DEFAULT_SESSION_CONFIG } from "./types.js";

// JSON Schema 类型（简化版）
type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  default?: unknown;
  description?: string;
  pattern?: string;
  minimum?: number;
  minItems?: number;
  minLength?: number;
};

export const acpConfigSchema: JSONSchema = {
  type: "object",
  properties: {
    enabled: {
      type: "boolean",
      default: false,
      description: "Enable ACP channel",
    },
    agentName: {
      type: "string",
      description: "Agent name (without domain, e.g., 'my-agent'). Required when channel is enabled",
      pattern: "^[a-z0-9-]+$",
    },
    domain: {
      type: "string",
      default: "aid.pub",
      description: "ACP domain (e.g., aid.pub)",
    },
    seedPassword: {
      type: "string",
      description: "Seed password for ACP identity",
    },
    ownerAid: {
      type: "string",
      description: "Owner's AID (e.g., 'owner-name.aid.pub')",
    },
    allowFrom: {
      type: "array",
      items: { type: "string" },
      description: "List of AIDs allowed to send messages (use * for all)",
    },
    agentMdPath: {
      type: "string",
      description: "Path to agent.md file (auto-upload on login)",
    },
    workspaceDir: {
      type: "string",
      description: "Workspace directory path for auto-generating agent.md from source files",
    },
    profile: {
      type: "object",
      properties: {
        displayName: { type: "string" },
        description: { type: "string" },
        capabilities: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    session: {
      type: "object",
      description: "Session termination control settings",
      properties: {
        endMarkers: {
          type: "array",
          items: { type: "string", minLength: 3 },
          default: [...DEFAULT_SESSION_CONFIG.endMarkers],
          description: "End markers to detect session termination (min 3 chars each)",
        },
        consecutiveEmptyThreshold: {
          type: "number",
          default: DEFAULT_SESSION_CONFIG.consecutiveEmptyThreshold,
          minimum: 1,
          description: "Number of consecutive empty replies before closing session",
        },
        sendEndMarkerOnClose: {
          type: "boolean",
          default: DEFAULT_SESSION_CONFIG.sendEndMarkerOnClose,
          description: "Send end marker when closing session",
        },
        sendAckOnReceiveEnd: {
          type: "boolean",
          default: DEFAULT_SESSION_CONFIG.sendAckOnReceiveEnd,
          description: "Send ACK when receiving end marker",
        },
        maxTurns: {
          type: "number",
          default: DEFAULT_SESSION_CONFIG.maxTurns,
          minimum: 1,
          description: "Maximum inbound messages per session",
        },
        maxDurationMs: {
          type: "number",
          default: DEFAULT_SESSION_CONFIG.maxDurationMs,
          minimum: 1000,
          description: "Maximum session duration in milliseconds",
        },
        idleTimeoutMs: {
          type: "number",
          default: DEFAULT_SESSION_CONFIG.idleTimeoutMs,
          minimum: 1000,
          description: "Idle timeout in milliseconds",
        },
        maxConcurrentSessions: {
          type: "number",
          default: DEFAULT_SESSION_CONFIG.maxConcurrentSessions,
          minimum: 1,
          description: "Maximum concurrent sessions before LRU eviction",
        },
      },
    },
  },
};
