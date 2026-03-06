import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok, err } from "../tool-context.js";
import * as path from "path";
import * as os from "os";
import { PrintMonitor } from "../print-monitor.js";
import { createVisionProvider } from "../vision-provider.js";
import { captureSnapshot } from "./camera.js";

export const tools: Tool[] = [
  {
    name: "monitor_start",
    description:
      "Start AI-powered print monitoring. Captures camera snapshots on an interval, " +
      "checks MQTT status for errors, and runs AI vision analysis to detect failures " +
      "(spaghetti, detachment, blobs). Automatically sends emergency stop on failure. " +
      "Works with any Bambu printer that has a camera. " +
      "Requires: MQTT connected + a vision provider configured via env vars " +
      "(AZURE_OPENAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY).",
    inputSchema: {
      type: "object",
      properties: {
        interval_seconds: {
          type: "number",
          description:
            "Seconds between monitoring cycles (default: 60, min: 10)",
        },
        min_layer: {
          type: "number",
          description:
            "Skip AI vision before this layer number (default: 2). Early layers have too little material to judge.",
        },
        snapshot_dir: {
          type: "string",
          description:
            "Directory to save snapshots (default: ~/Downloads/printer_monitor)",
        },
        fail_strikes: {
          type: "number",
          description:
            "Number of consecutive vision failures required before emergency stop (default: 3). Prevents false positives from single ambiguous frames.",
        },
      },
      required: [],
    },
  },
  {
    name: "monitor_status",
    description:
      "Get the current state of the AI print monitor — cycle count, last verdict, " +
      "print progress, failure status, and any non-fatal errors.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "monitor_stop",
    description:
      "Stop the AI print monitor. Returns a summary of the monitoring session. " +
      "Does NOT stop the print itself — use printer_stop for that.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    monitor_start: async (args: {
      interval_seconds?: number;
      min_layer?: number;
      snapshot_dir?: string;
      fail_strikes?: number;
    }) => {
      const existing = ctx.getMonitor();
      if (existing) {
        const state = existing.getState();
        if (state.active) {
          return err(
            "Monitor is already running. Use monitor_stop first, or monitor_status to check progress.",
          );
        }
      }

      const mqtt = ctx.requireMQTT();

      let visionProvider;
      try {
        visionProvider = createVisionProvider();
      } catch (e: any) {
        return err(e.message);
      }

      const host = ctx.getEnv("BAMBU_LAB_MQTT_HOST");
      const accessCode = ctx.getEnv("BAMBU_LAB_MQTT_PASSWORD");
      if (!host || !accessCode) {
        return err(
          "Camera requires printer host and access code. Set BAMBU_LAB_MQTT_HOST and BAMBU_LAB_MQTT_PASSWORD.",
        );
      }

      const intervalSeconds = Math.max(args.interval_seconds || 60, 10);
      const snapshotDir =
        args.snapshot_dir ||
        path.join(os.homedir(), "Downloads", "printer_monitor");

      const failStrikes = Math.max(args.fail_strikes || 3, 1);

      const monitor = new PrintMonitor(
        {
          intervalSeconds,
          minLayerForVision: args.min_layer ?? 2,
          failStrikes,
          host,
          accessCode,
          snapshotDir,
        },
        {
          captureSnapshot,
          mqttClient: mqtt,
          visionProvider,
          onLog: (level, message) => {
            console.error(`[monitor] [${level}] ${message}`);
            try {
              ctx.getServer().sendLoggingMessage({
                level:
                  level === "info"
                    ? "info"
                    : level === "warning"
                      ? "warning"
                      : "error",
                data: message,
              });
            } catch {
              // Logging notification failures are non-fatal
            }
          },
        },
      );

      monitor.start();
      ctx.setMonitor(monitor);

      return ok({
        message: "Print monitor started",
        interval_seconds: intervalSeconds,
        min_layer: args.min_layer ?? 2,
        fail_strikes: failStrikes,
        snapshot_dir: snapshotDir,
        vision_provider: `${visionProvider.name}/${visionProvider.model}`,
      });
    },

    monitor_status: async () => {
      const monitor = ctx.getMonitor();
      if (!monitor) {
        return ok({
          active: false,
          message: "No monitor running. Use monitor_start to begin monitoring.",
        });
      }
      return ok(monitor.getState());
    },

    monitor_stop: async () => {
      const monitor = ctx.getMonitor();
      if (!monitor) {
        return ok({
          active: false,
          message: "No monitor running.",
        });
      }

      const finalState = monitor.stop();
      ctx.setMonitor(null);

      return ok({
        message: "Monitor stopped",
        summary: {
          cycles_completed: finalState.cycleCount,
          failure_detected: finalState.failureDetected,
          failure_reason: finalState.failureReason,
          emergency_stop_sent: finalState.emergencyStopSent,
          last_print_state: finalState.printState,
          last_print_percent: finalState.printPercent,
          errors: finalState.errors,
        },
      });
    },
  };
}

const monitorModule: ToolModule = { tools, createHandlers };
export default monitorModule;
