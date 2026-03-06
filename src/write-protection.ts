import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const DANGEROUS_TOOLS = new Set([
  "printer_stop",
  "printer_pause",
  "printer_resume",
  "printer_set_speed",
  "printer_send_gcode",
  "printer_print_file",
  "skip_objects",
  "ams_change_filament",
  "ams_unload_filament",
  "camera_record",
  "camera_timelapse",
  "led_control",
  "set_nozzle",
  "set_temperature",
  "ftp_upload_file",
  "makerworld_print",
]);

export function addConfirmParam(tool: Tool): Tool {
  if (!DANGEROUS_TOOLS.has(tool.name)) return tool;

  const schema = { ...tool.inputSchema } as any;
  const properties = { ...schema.properties };
  properties.confirmDangerousAction = {
    type: "boolean",
    description:
      "Must be set to true to execute this state-changing action. " +
      "Without confirmation, returns a warning instead of executing.",
  };
  schema.properties = properties;

  return { ...tool, inputSchema: schema };
}

export function checkConfirmation(name: string, args: any): string | null {
  if (!DANGEROUS_TOOLS.has(name)) return null;

  if (args?.confirmDangerousAction === true) return null;

  return (
    `Tool "${name}" is a dangerous/state-changing action. ` +
    `Set confirmDangerousAction: true to execute. ` +
    `This safeguard prevents accidental printer operations.`
  );
}
