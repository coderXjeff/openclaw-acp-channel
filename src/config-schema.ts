// JSON Schema 类型（简化版）
type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  default?: unknown;
  description?: string;
  pattern?: string;
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
      description: "Agent name (without domain, e.g., 'my-agent')",
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
  },
  required: ["agentName"],
};
