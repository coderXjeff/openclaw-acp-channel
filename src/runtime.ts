import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAcpRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getAcpRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("ACP runtime not initialized");
  }
  return runtime;
}

export function hasAcpRuntime(): boolean {
  return runtime !== null;
}
