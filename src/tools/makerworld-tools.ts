import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok, err } from "../tool-context.js";
import * as path from "path";
import { makerWorldDownload } from "../makerworld.js";
import { slice3mf } from "./slicer.js";
import { ftpUploadFile } from "./files.js";

export const tools: Tool[] = [
  {
    name: "makerworld_download",
    description:
      "Download a 3MF print file from MakerWorld (makerworld.com). " +
      "Accepts a URL, instance_id, or path to an already-downloaded file. " +
      "When Cloudflare blocks direct access, returns step-by-step instructions " +
      "for browser-assisted download using Firefox DevTools MCP.\n\n" +
      "DEPENDENCY: Firefox DevTools MCP is required for browser-based downloads. " +
      "Install with: npx firefox-devtools-mcp@latest\n" +
      "Add to ~/.claude/user-mcps.json:\n" +
      '  "firefox-devtools": { "command": "npx", "args": ["firefox-devtools-mcp@latest"] }',
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "MakerWorld model URL (e.g., https://makerworld.com/en/models/12345-model-name)",
        },
        instance_id: {
          type: "string",
          description:
            "MakerWorld instance ID for direct download (from __NEXT_DATA__ on the model page: design.instances[].id where isDefault=true)",
        },
        download_path: {
          type: "string",
          description:
            "Path to an already-downloaded 3MF file (skips download, validates and returns file info)",
        },
        cookies: {
          type: "string",
          description:
            "Browser cookies for Cloudflare bypass (extract from Firefox DevTools network request headers)",
        },
        output_dir: {
          type: "string",
          description: "Directory to save the file (default: ~/Downloads)",
        },
      },
      required: [],
    },
  },
  {
    name: "makerworld_print",
    description:
      "Download a model from MakerWorld and print it on the connected printer. " +
      "Combines makerworld_download -> ftp_upload -> printer_print_file in one step.\n\n" +
      "DEPENDENCY: Firefox DevTools MCP for MakerWorld access. " +
      "Install: npx firefox-devtools-mcp@latest",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "MakerWorld model URL",
        },
        download_path: {
          type: "string",
          description: "Path to already-downloaded 3MF (skips download)",
        },
        instance_id: {
          type: "string",
          description: "MakerWorld instance ID for direct download",
        },
        cookies: {
          type: "string",
          description: "Browser cookies for Cloudflare bypass",
        },
        host: {
          type: "string",
          description:
            "Printer IP (defaults to currently connected MQTT printer)",
        },
        password: {
          type: "string",
          description:
            "Printer access code (defaults to current MQTT password)",
        },
        plate: {
          type: "number",
          description:
            "Plate number for multi-plate 3MF files (1-based, default: 1)",
        },
        ams_mapping: {
          type: "array",
          items: { type: "number" },
          description:
            "AMS slot mapping. Index = color in file, value = AMS slot (0-3) or -1 for external. Default: [0]",
        },
        bed_type: {
          type: "string",
          enum: [
            "auto",
            "cool_plate",
            "engineering_plate",
            "textured_pei_plate",
          ],
          description: "Bed plate type (default: auto)",
        },
        use_ams: {
          type: "boolean",
          description: "Use AMS for filament (default: true)",
        },
        timelapse: {
          type: "boolean",
          description: "Record timelapse (default: false)",
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
    makerworld_download: async (args: {
      url?: string;
      instance_id?: string;
      download_path?: string;
      cookies?: string;
      output_dir?: string;
    }) => {
      const result = await makerWorldDownload(args);
      return ok(result);
    },

    makerworld_print: async (args: {
      url?: string;
      download_path?: string;
      instance_id?: string;
      cookies?: string;
      host?: string;
      password?: string;
      bed_type?: string;
      use_ams?: boolean;
      ams_mapping?: number[];
      plate?: number;
      timelapse?: boolean;
    }) => {
      // Step 1: Get the file
      const dlResult = await makerWorldDownload({
        url: args.url,
        instance_id: args.instance_id,
        download_path: args.download_path,
        cookies: args.cookies,
      });

      if (dlResult.steps) {
        return ok({
          ...dlResult,
          message:
            "Download requires browser assistance. Complete the download steps, then call makerworld_print again with download_path.",
        });
      }

      const filePath = dlResult.path;
      if (!filePath) {
        return err("No file path in download result", JSON.stringify(dlResult));
      }

      // Step 2: Slice if needed
      let slicedPath: string;
      try {
        slicedPath = await slice3mf(filePath);
      } catch (sliceErr: any) {
        return err(
          `Slicing failed: ${sliceErr.message}`,
          "Install OrcaSlicer (brew install --cask orcaslicer) for automatic slicing.",
        );
      }

      // Step 3: Get printer connection info
      const mqtt = ctx.requireMQTT();
      const host =
        args.host ||
        ctx.getEnv("BAMBU_LAB_MQTT_HOST") ||
        (mqtt as any)["config"]?.host;
      const password =
        args.password ||
        ctx.getEnv("BAMBU_LAB_MQTT_PASSWORD") ||
        (mqtt as any)["config"]?.password;

      if (!host || !password) {
        return err(
          "Printer host and password required for FTP upload. Connect via MQTT first or provide host/password.",
        );
      }

      // Step 4: Upload sliced file via FTP
      const remoteName = path.basename(slicedPath);
      const uploadResult = await ftpUploadFile({
        host,
        local_path: slicedPath,
        remote_path: remoteName,
        password,
      });

      // Step 5: Start printing
      const printResult = await mqtt.printFile({
        file: remoteName,
        plate: args.plate,
        ams_mapping: args.ams_mapping,
        bed_type: args.bed_type,
        use_ams: args.use_ams,
        timelapse: args.timelapse,
      });

      return ok({
        message: `Printing ${remoteName} from MakerWorld`,
        download: dlResult,
        sliced: slicedPath !== filePath ? slicedPath : "already sliced",
        upload: uploadResult,
        print: printResult,
      });
    },
  };
}

const makerWorldModule: ToolModule = { tools, createHandlers };
export default makerWorldModule;
