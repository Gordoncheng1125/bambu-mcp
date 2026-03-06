import * as path from "path";
import * as fs from "fs";

export const BLOCKED_GCODE_PREFIXES = [
  "M112", // Emergency stop (use printer_stop tool instead)
  "M502", // Factory reset
  "M500", // Save settings to EEPROM
  "M501", // Restore settings from EEPROM
  "M997", // Firmware update
  "M999", // Restart after emergency stop
];

export const SAFE_TEMP_LIMITS = {
  nozzle: 300,
  bed: 120,
};

export const ALLOWED_UPLOAD_EXTENSIONS = [".gcode", ".3mf", ".stl"];

export function validateGcode(gcode: string): string | null {
  const upper = gcode.trim().toUpperCase();

  for (const prefix of BLOCKED_GCODE_PREFIXES) {
    if (upper.startsWith(prefix)) {
      return `G-code ${prefix} is blocked for safety. Use the appropriate MCP tool instead.`;
    }
  }

  const tempMatch = upper.match(/^M10[49]\s+S(\d+)/);
  if (tempMatch) {
    const temp = parseInt(tempMatch[1]);
    if (temp > SAFE_TEMP_LIMITS.nozzle) {
      return `Nozzle temperature ${temp}C exceeds safe limit of ${SAFE_TEMP_LIMITS.nozzle}C`;
    }
  }

  const bedTempMatch = upper.match(/^M140\s+S(\d+)/);
  if (bedTempMatch) {
    const temp = parseInt(bedTempMatch[1]);
    if (temp > SAFE_TEMP_LIMITS.bed) {
      return `Bed temperature ${temp}C exceeds safe limit of ${SAFE_TEMP_LIMITS.bed}C`;
    }
  }

  return null;
}

export function validateFTPPath(localPath: string): string | null {
  const resolved = path.resolve(localPath);
  const ext = path.extname(resolved).toLowerCase();

  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext)) {
    return `File extension "${ext}" not allowed. Allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}`;
  }

  if (!fs.existsSync(resolved)) {
    return `File not found: ${resolved}`;
  }

  return null;
}

export function validateRemotePath(remotePath: string): string | null {
  if (remotePath.includes("..") || remotePath.startsWith("/")) {
    return `Invalid remote path: must be a relative filename without ".." traversal`;
  }
  return null;
}
