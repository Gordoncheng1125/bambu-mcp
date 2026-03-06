import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok } from "../tool-context.js";
import { validateGcode } from "../safety.js";

const SPEED_PROFILES: Record<string, number> = {
  silent: 50,
  standard: 100,
  sport: 125,
  ludicrous: 166,
};

export const tools: Tool[] = [
  {
    name: "printer_stop",
    description: "Stop the current print job immediately",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "printer_pause",
    description: "Pause the current print job",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "printer_resume",
    description: "Resume a paused print job",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "printer_set_speed",
    description:
      "Set print speed. Use a named profile (silent/standard/sport/ludicrous) or a percentage (1-166).",
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          enum: ["silent", "standard", "sport", "ludicrous"],
          description: "Named speed profile",
        },
        speed: {
          type: "number",
          description: "Speed percentage (1-166). Ignored if profile is set.",
        },
      },
      required: [],
    },
  },
  {
    name: "printer_send_gcode",
    description:
      'Send a single G-code command to the printer (e.g., "G28" for home). Dangerous commands are blocked for safety.',
    inputSchema: {
      type: "object",
      properties: {
        gcode: { type: "string", description: "G-code command" },
      },
      required: ["gcode"],
    },
  },
  {
    name: "printer_print_file",
    description:
      "Start printing a file on the printer SD card (uploaded via ftp_upload_file). " +
      "Auto-detects .3mf vs .gcode — for .3mf files uses project_file command (requires Developer Mode). " +
      "For .3mf: ams_mapping maps print colors to AMS slots (index=color, value=slot 0-3 or -1 for external).",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "Filename on printer storage (e.g. 'model.3mf' or 'print.gcode')",
        },
        plate: {
          type: "number",
          description: "Plate number for .3mf files (1-based, default: 1)",
        },
        ams_mapping: {
          type: "array",
          items: { type: "number" },
          description:
            "AMS slot mapping for .3mf files. Array index = color in file, value = AMS slot (0-3) or -1 for external. " +
            "Single color slot 0: [0]. Two colors: [0, 1]. Use ams_filament_mapping to check which slot has which filament.",
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
        timelapse: {
          type: "boolean",
          description: "Enable timelapse recording",
        },
        use_ams: {
          type: "boolean",
          description: "Use AMS for filament (default: true)",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "skip_objects",
    description:
      "Skip specific objects during a multi-object print. Useful for excluding failed parts without stopping the entire print.",
    inputSchema: {
      type: "object",
      properties: {
        object_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of object IDs to skip",
        },
      },
      required: ["object_ids"],
    },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    printer_stop: async () => {
      return ok({
        message: "Print stopped",
        result: await ctx.requireMQTT().stopPrint(),
      });
    },

    printer_pause: async () => {
      return ok({
        message: "Print paused",
        result: await ctx.requireMQTT().pausePrint(),
      });
    },

    printer_resume: async () => {
      return ok({
        message: "Print resumed",
        result: await ctx.requireMQTT().resumePrint(),
      });
    },

    printer_set_speed: async (args: { profile?: string; speed?: number }) => {
      const mqtt = ctx.requireMQTT();

      let speed: number;
      if (args.profile) {
        const profileSpeed = SPEED_PROFILES[args.profile.toLowerCase()];
        if (!profileSpeed) {
          throw new Error(
            `Unknown speed profile. Use: ${Object.keys(SPEED_PROFILES).join(", ")}`,
          );
        }
        speed = profileSpeed;
      } else if (args.speed !== undefined) {
        speed = args.speed;
      } else {
        throw new Error("Provide either a speed profile or a speed percentage");
      }

      if (speed < 1 || speed > 166) {
        throw new Error("Speed must be between 1 and 166");
      }

      const result = await mqtt.setPrintSpeed(speed);
      return ok({
        message: `Speed set to ${speed}%${args.profile ? ` (${args.profile})` : ""}`,
        result,
      });
    },

    printer_send_gcode: async (args: { gcode: string }) => {
      const validationError = validateGcode(args.gcode);
      if (validationError) throw new Error(validationError);

      const result = await ctx.requireMQTT().sendGcode(args.gcode);
      return ok({ message: `G-code sent: ${args.gcode}`, result });
    },

    printer_print_file: async (args: {
      file: string;
      plate?: number;
      ams_mapping?: number[];
      bed_type?: string;
      timelapse?: boolean;
      use_ams?: boolean;
    }) => {
      const result = await ctx.requireMQTT().printFile(args);
      return ok({ message: `Started printing: ${args.file}`, result });
    },

    skip_objects: async (args: { object_ids: number[] }) => {
      if (!args.object_ids?.length) {
        throw new Error("Provide at least one object ID to skip");
      }
      const result = await ctx.requireMQTT().skipObjects(args.object_ids);
      return ok({
        message: `Skipping objects: ${args.object_ids.join(", ")}`,
        result,
      });
    },
  };
}

const printControlModule: ToolModule = { tools, createHandlers };
export default printControlModule;
