import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok } from "../tool-context.js";
import { SAFE_TEMP_LIMITS } from "../safety.js";

export const tools: Tool[] = [
  {
    name: "led_control",
    description: "Control the printer chamber or logo LED lights",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["on", "off"],
          description: "LED state",
        },
        node: {
          type: "string",
          enum: ["chamber_light", "work_light"],
          description: "Which LED to control (default: chamber_light)",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "set_nozzle",
    description: "Set the nozzle diameter (for printing profile selection)",
    inputSchema: {
      type: "object",
      properties: {
        diameter: {
          type: "number",
          description: "Nozzle diameter in mm (e.g., 0.4, 0.6, 0.8)",
        },
      },
      required: ["diameter"],
    },
  },
  {
    name: "set_temperature",
    description:
      "Set nozzle or bed temperature via G-code. Validates against safe limits.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["nozzle", "bed"],
          description: "Which heater to set",
        },
        temperature: {
          type: "number",
          description: `Temperature in Celsius (nozzle max: ${SAFE_TEMP_LIMITS.nozzle}, bed max: ${SAFE_TEMP_LIMITS.bed})`,
        },
      },
      required: ["target", "temperature"],
    },
  },
];

export function createHandlers(
  ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    led_control: async (args: { mode: "on" | "off"; node?: string }) => {
      const result = await ctx.requireMQTT().setLED(args.mode, args.node);
      return ok({
        message: `LED ${args.node || "chamber_light"} ${args.mode}`,
        result,
      });
    },

    set_nozzle: async (args: { diameter: number }) => {
      const result = await ctx.requireMQTT().setNozzle(args.diameter);
      return ok({
        message: `Nozzle diameter set to ${args.diameter}mm`,
        result,
      });
    },

    set_temperature: async (args: {
      target: "nozzle" | "bed";
      temperature: number;
    }) => {
      const mqtt = ctx.requireMQTT();
      const { target, temperature } = args;

      const limit =
        target === "nozzle" ? SAFE_TEMP_LIMITS.nozzle : SAFE_TEMP_LIMITS.bed;
      if (temperature < 0 || temperature > limit) {
        throw new Error(
          `${target} temperature must be between 0 and ${limit}C`,
        );
      }

      const gcode =
        target === "nozzle" ? `M104 S${temperature}` : `M140 S${temperature}`;
      const result = await mqtt.sendGcode(gcode);

      return ok({
        message: `${target} temperature set to ${temperature}C`,
        gcode,
        result,
      });
    },
  };
}

const hardwareModule: ToolModule = { tools, createHandlers };
export default hardwareModule;
