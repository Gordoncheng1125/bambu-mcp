import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok } from "../tool-context.js";

export const tools: Tool[] = [
  {
    name: "ams_change_filament",
    description: "Change to a different AMS filament tray (0-3)",
    inputSchema: {
      type: "object",
      properties: {
        tray: {
          type: "number",
          description: "AMS tray number (0-3)",
        },
        target_temp: {
          type: "number",
          description: "Target nozzle temperature for the filament",
        },
      },
      required: ["tray"],
    },
  },
  {
    name: "ams_unload_filament",
    description: "Unload the current filament from the extruder",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ams_filament_mapping",
    description:
      "Get the current AMS filament tray mapping — shows which filament " +
      "type and color is loaded in each slot (0-3). Useful for selecting " +
      "the right tray before printing.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    ams_change_filament: async (args: {
      tray: number;
      target_temp?: number;
    }) => {
      if (args.tray < 0 || args.tray > 3) {
        throw new Error("AMS tray must be between 0 and 3");
      }
      const result = await ctx
        .requireMQTT()
        .changeFilament(args.tray, args.target_temp);
      return ok({ message: `Changing to AMS tray ${args.tray}`, result });
    },

    ams_unload_filament: async () => {
      return ok({
        message: "Unloading filament",
        result: await ctx.requireMQTT().unloadFilament(),
      });
    },

    ams_filament_mapping: async () => {
      const mqtt = ctx.requireMQTT();
      const status = mqtt.getCachedStatus();
      const ams = status?.ams;

      if (!ams?.ams?.length) {
        return ok({
          message:
            "No AMS data available. Request a status update first with printer_get_status.",
          suggestion:
            "Call printer_get_status to refresh AMS data, then try again.",
        });
      }

      const mapping = ams.ams.flatMap((unit: any) => {
        const unitId = unit.id;
        const trays = (unit.tray || []).map((tray: any) => {
          const color = tray.tray_color ? `#${tray.tray_color}` : "unknown";
          return {
            unit: parseInt(unitId),
            slot: parseInt(tray.id),
            global_slot: parseInt(unitId) * 4 + parseInt(tray.id),
            filament_type: tray.tray_type || "empty",
            color,
            color_hex: tray.tray_color || null,
            remaining_percent: tray.remain ?? null,
            tray_sub_brands: tray.tray_sub_brands || null,
          };
        });
        return trays;
      });

      return ok({
        message: "AMS filament tray mapping",
        current_tray: ams.tray_now,
        trays: mapping,
      });
    },
  };
}

const amsModule: ToolModule = { tools, createHandlers };
export default amsModule;
