import type { BambuLabConfig } from "./types.js";
import type { BambuMQTTClient } from "./mqtt-client.js";
import type { PrintMonitor } from "./print-monitor.js";
import { redactOutput } from "./redact.js";

export interface ToolContext {
  config: BambuLabConfig;
  getMqttClient(): BambuMQTTClient | null;
  setMqttClient(client: BambuMQTTClient | null): void;
  requireMQTT(): BambuMQTTClient;
  getMonitor(): PrintMonitor | null;
  setMonitor(monitor: PrintMonitor | null): void;
  getServer(): any;
  getEnv(key: string): string;
}

export function ok(data: any) {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text: redactOutput(text) }],
  };
}

export function err(message: string, details?: string) {
  const text = JSON.stringify(
    { error: message, ...(details ? { details } : {}) },
    null,
    2,
  );
  return {
    content: [{ type: "text" as const, text: redactOutput(text) }],
    isError: true,
  };
}
