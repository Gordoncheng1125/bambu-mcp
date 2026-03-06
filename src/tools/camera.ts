import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok, err } from "../tool-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as tls from "tls";

export function captureSnapshot(
  host: string,
  accessCode: string,
  outputPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      { host, port: 6000, rejectUnauthorized: false },
      () => {
        const auth = Buffer.alloc(80, 0);
        auth.writeUInt32LE(0x40, 0);
        auth.writeUInt32LE(0x3000, 4);
        Buffer.from("bblp", "ascii").copy(auth, 16);
        Buffer.from(accessCode, "ascii").copy(auth, 48);
        sock.write(auth);
      },
    );

    let pending = Buffer.alloc(0);
    let payloadSize = 0;
    let frameBuf: Buffer | null = null;
    let done = false;

    sock.on("data", (chunk) => {
      if (done) return;
      pending = Buffer.concat([pending, chunk]);

      while (pending.length > 0 && !done) {
        if (frameBuf === null) {
          if (pending.length < 16) break;
          payloadSize = pending[0] | (pending[1] << 8) | (pending[2] << 16);
          frameBuf = Buffer.alloc(0);
          pending = pending.subarray(16);
        } else {
          const needed = payloadSize - frameBuf.length;
          const take = Math.min(needed, pending.length);
          frameBuf = Buffer.concat([frameBuf, pending.subarray(0, take)]);
          pending = pending.subarray(take);

          if (frameBuf.length === payloadSize) {
            const validStart = frameBuf[0] === 0xff && frameBuf[1] === 0xd8;
            const validEnd =
              frameBuf[frameBuf.length - 2] === 0xff &&
              frameBuf[frameBuf.length - 1] === 0xd9;

            if (validStart && validEnd) {
              fs.writeFileSync(outputPath, frameBuf);
              done = true;
              sock.destroy();
              resolve(outputPath);
              return;
            }
            frameBuf = null;
          }
        }
      }
    });

    sock.on("error", (err) => {
      if (!done) reject(new Error(`Camera stream error: ${err.message}`));
    });

    setTimeout(() => {
      if (!done) {
        sock.destroy();
        reject(new Error("Camera snapshot timed out (10s)"));
      }
    }, 10000);
  });
}

export const tools: Tool[] = [
  {
    name: "camera_record",
    description: "Enable or disable camera recording on the printer",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "true to start recording, false to stop",
        },
      },
      required: ["enabled"],
    },
  },
  {
    name: "camera_timelapse",
    description: "Enable or disable timelapse recording for the current print",
    inputSchema: {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          description: "true to enable timelapse, false to disable",
        },
      },
      required: ["enabled"],
    },
  },
  {
    name: "camera_snapshot",
    description:
      "Capture a live JPEG snapshot from the printer's chamber camera. " +
      "Connects via TLS to port 6000, authenticates, and grabs a single frame. " +
      "Returns the file path to the saved JPEG image.",
    inputSchema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "Printer IP (defaults to MQTT-connected printer)",
        },
        password: {
          type: "string",
          description: "Printer access code (defaults to MQTT password)",
        },
        output_path: {
          type: "string",
          description:
            "Where to save the JPEG (default: ~/Downloads/printer_snapshot.jpg)",
        },
      },
      required: [],
    },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    camera_record: async (args: { enabled: boolean }) => {
      const result = await ctx.requireMQTT().setCameraRecording(args.enabled);
      return ok({
        message: `Camera recording ${args.enabled ? "enabled" : "disabled"}`,
        result,
      });
    },

    camera_timelapse: async (args: { enabled: boolean }) => {
      const result = await ctx.requireMQTT().setTimelapse(args.enabled);
      return ok({
        message: `Timelapse ${args.enabled ? "enabled" : "disabled"}`,
        result,
      });
    },

    camera_snapshot: async (args: {
      host?: string;
      password?: string;
      output_path?: string;
    }) => {
      const host = args.host || ctx.getEnv("BAMBU_LAB_MQTT_HOST");
      const password = args.password || ctx.getEnv("BAMBU_LAB_MQTT_PASSWORD");

      if (!host || !password) {
        return err(
          "Printer host and access code required. Connect via MQTT first or provide host/password.",
        );
      }

      const outputPath =
        args.output_path ||
        path.join(
          os.homedir(),
          "Downloads",
          `printer_snapshot_${Date.now()}.jpg`,
        );

      const saved = await captureSnapshot(host, password, outputPath);
      const stats = fs.statSync(saved);

      return ok({
        message: "Camera snapshot captured",
        path: saved,
        size_bytes: stats.size,
      });
    },
  };
}

const cameraModule: ToolModule = { tools, createHandlers };
export default cameraModule;
