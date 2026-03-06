import type { ToolContext } from "./tool-context.js";
import {
  BLOCKED_GCODE_PREFIXES,
  SAFE_TEMP_LIMITS,
  ALLOWED_UPLOAD_EXTENSIONS,
} from "./safety.js";
import { DANGEROUS_TOOLS } from "./write-protection.js";

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export function getResources(): MCPResource[] {
  return [
    {
      uri: "bambu://printer/status",
      name: "Printer Status",
      description:
        "Live printer status from cached MQTT reports (temperatures, print progress, AMS, fans)",
      mimeType: "application/json",
    },
    {
      uri: "bambu://printer/capabilities",
      name: "Printer Capabilities",
      description:
        "Static reference: speed profiles, temperature limits, AMS slots, supported nozzles",
      mimeType: "application/json",
    },
    {
      uri: "bambu://knowledge/safety",
      name: "Safety Reference",
      description:
        "G-code blocklist, temperature limits, file extension whitelist, dangerous tool list",
      mimeType: "application/json",
    },
    {
      uri: "bambu://knowledge/protocol",
      name: "Protocol Reference",
      description:
        "MQTT topics, command structure, camera protocol, FTP details",
      mimeType: "application/json",
    },
  ];
}

export function readResource(uri: string, ctx: ToolContext): string {
  switch (uri) {
    case "bambu://printer/status": {
      const client = ctx.getMqttClient();
      if (!client || !client.isConnected()) {
        return JSON.stringify(
          {
            connected: false,
            message: "MQTT not connected. Use mqtt_connect first.",
          },
          null,
          2,
        );
      }
      return JSON.stringify(client.getCachedStatus(), null, 2);
    }

    case "bambu://printer/capabilities":
      return JSON.stringify(
        {
          speed_profiles: {
            silent: 50,
            standard: 100,
            sport: 125,
            ludicrous: 166,
          },
          temperature_limits: SAFE_TEMP_LIMITS,
          ams: {
            max_units: 1,
            slots_per_unit: 4,
            tray_range: [0, 3],
          },
          supported_nozzles_mm: [0.2, 0.4, 0.6, 0.8],
          supported_bed_types: [
            "auto",
            "cool_plate",
            "engineering_plate",
            "textured_pei_plate",
          ],
        },
        null,
        2,
      );

    case "bambu://knowledge/safety":
      return JSON.stringify(
        {
          blocked_gcode_prefixes: BLOCKED_GCODE_PREFIXES,
          temperature_limits: SAFE_TEMP_LIMITS,
          allowed_upload_extensions: ALLOWED_UPLOAD_EXTENSIONS,
          dangerous_tools: [...DANGEROUS_TOOLS],
        },
        null,
        2,
      );

    case "bambu://knowledge/protocol":
      return JSON.stringify(
        {
          mqtt: {
            default_port: 8883,
            protocol: "mqtts",
            default_username: "bblp",
            topics: {
              report: "device/{device_id}/report",
              request: "device/{device_id}/request",
            },
            command_format: {
              example: '{"print":{"sequence_id":"0","command":"pause"}}',
              types: [
                "print",
                "pushing",
                "info",
                "system",
                "camera",
                "upgrade",
              ],
            },
          },
          camera: {
            port: 6000,
            protocol: "TLS",
            auth_header_size: 80,
            frame_header_size: 16,
            format: "JPEG",
          },
          ftp: {
            port: 990,
            protocol: "FTPS",
            default_user: "bblp",
          },
          reference: "https://github.com/Doridian/OpenBambuAPI",
        },
        null,
        2,
      );

    default:
      throw new Error(`Unknown resource URI: ${uri}`);
  }
}
