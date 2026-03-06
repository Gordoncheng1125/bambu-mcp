import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok } from "../tool-context.js";
import { validateFTPPath, validateRemotePath } from "../safety.js";
import { Client as FTPClient } from "basic-ftp";
import { execFile } from "child_process";

export const tools: Tool[] = [
  {
    name: "ftp_upload_file",
    description:
      "Upload a .gcode, .3mf, or .stl file to the printer SD card via FTPS (port 990). Use printer_print_file to start the print after upload.",
    inputSchema: {
      type: "object",
      properties: {
        host: { type: "string", description: "Printer IP address" },
        local_path: {
          type: "string",
          description: "Path to local file to upload",
        },
        remote_path: {
          type: "string",
          description: "Filename on printer (e.g., model.gcode)",
        },
        password: {
          type: "string",
          description: "LAN access code from printer",
        },
      },
      required: ["host", "local_path", "remote_path", "password"],
    },
  },
];

function ftpUploadViaCurl(args: {
  host: string;
  local_path: string;
  remote_path: string;
  password: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const ftpsUrl = `ftps://bblp:${args.password}@${args.host}:990/${args.remote_path}`;
    execFile(
      "curl",
      ["--ftp-ssl-reqd", "--insecure", "-T", args.local_path, ftpsUrl],
      { timeout: 60000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(
            new Error(`curl FTPS upload failed: ${stderr || error.message}`),
          );
        } else {
          resolve();
        }
      },
    );
  });
}

export async function ftpUploadFile(args: {
  host: string;
  local_path: string;
  remote_path: string;
  password: string;
}) {
  const pathError = validateFTPPath(args.local_path);
  if (pathError) throw new Error(pathError);

  const remoteError = validateRemotePath(args.remote_path);
  if (remoteError) throw new Error(remoteError);

  try {
    const ftp = new FTPClient();
    ftp.ftp.verbose = false;

    await ftp.access({
      host: args.host,
      port: 990,
      user: "bblp",
      password: args.password,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    });

    await ftp.uploadFrom(args.local_path, args.remote_path);
    ftp.close();
  } catch (ftpError: any) {
    console.error(
      `basic-ftp failed (${ftpError.message}), falling back to curl`,
    );
    await ftpUploadViaCurl(args);
  }

  return ok({
    message: "File uploaded successfully",
    local: args.local_path,
    remote: args.remote_path,
    next_step: `Use printer_print_file with file="${args.remote_path}" to print`,
  });
}

export function createHandlers(
  _ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    ftp_upload_file: async (args: {
      host: string;
      local_path: string;
      remote_path: string;
      password: string;
    }) => {
      return ftpUploadFile(args);
    },
  };
}

const filesModule: ToolModule = { tools, createHandlers };
export default filesModule;
