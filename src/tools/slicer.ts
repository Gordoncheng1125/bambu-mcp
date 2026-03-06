import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolModule } from "./tool-module.js";
import type { ToolContext } from "../tool-context.js";
import { ok, err } from "../tool-context.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile, execFileSync } from "child_process";

export function findSlicerBinary(): string | null {
  const candidates = [
    "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  ];
  for (const bin of candidates) {
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

export function findSlicerProfiles(slicerBin: string): {
  machine: string;
  process: string;
  filament: string;
} | null {
  const resourcesDir = path.join(
    path.dirname(slicerBin),
    "..",
    "Resources",
    "profiles",
    "BBL",
  );
  const machine = path.join(
    resourcesDir,
    "machine",
    "Bambu Lab P1S 0.4 nozzle.json",
  );
  const process_ = path.join(
    resourcesDir,
    "process",
    "0.20mm Standard @BBL P1P.json",
  );
  let filament = path.join(
    resourcesDir,
    "filament",
    "P1P",
    "Generic PLA @BBL P1P.json",
  );
  if (!fs.existsSync(filament)) {
    filament = path.join(resourcesDir, "filament", "Generic PLA @BBL P1P.json");
  }
  if (
    !fs.existsSync(machine) ||
    !fs.existsSync(process_) ||
    !fs.existsSync(filament)
  ) {
    return null;
  }
  return { machine, process: process_, filament };
}

export function is3mfSliced(filePath: string): boolean {
  try {
    const output = execFileSync("unzip", ["-l", filePath], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.includes("plate_1.gcode") || output.includes("plate_2.gcode");
  } catch {
    return false;
  }
}

export function patch3mfForOrcaSlicer(extractDir: string): void {
  const configPath = path.join(
    extractDir,
    "Metadata",
    "project_settings.config",
  );
  if (!fs.existsSync(configPath)) return;
  let config = fs.readFileSync(configPath, "utf-8");
  const patches: [RegExp, string][] = [
    [
      /"raft_first_layer_expansion":\s*"-1"/g,
      '"raft_first_layer_expansion": "0"',
    ],
    [/"solid_infill_filament":\s*"0"/g, '"solid_infill_filament": "1"'],
    [/"sparse_infill_filament":\s*"0"/g, '"sparse_infill_filament": "1"'],
    [/"tree_support_wall_count":\s*"-1"/g, '"tree_support_wall_count": "0"'],
    [/"wall_filament":\s*"0"/g, '"wall_filament": "1"'],
  ];
  for (const [pattern, replacement] of patches) {
    config = config.replace(pattern, replacement);
  }
  fs.writeFileSync(configPath, config);
}

export async function slice3mf(
  inputPath: string,
  outputPath?: string,
): Promise<string> {
  if (is3mfSliced(inputPath)) {
    return inputPath;
  }

  const slicer = findSlicerBinary();
  if (!slicer) {
    throw new Error(
      "No slicer found. Install OrcaSlicer (brew install --cask orcaslicer) or BambuStudio.",
    );
  }

  const profiles = findSlicerProfiles(slicer);
  if (!profiles) {
    throw new Error(
      "Could not find P1S printer profiles in slicer installation.",
    );
  }

  const outFile = outputPath || inputPath.replace(/\.3mf$/i, "_sliced.3mf");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bambu-slice-"));

  try {
    execFileSync("unzip", ["-o", inputPath, "-d", tmpDir], {
      stdio: "pipe",
    });

    patch3mfForOrcaSlicer(tmpDir);

    const patchedPath = path.join(tmpDir, "patched.3mf");
    execFileSync("zip", ["-r", patchedPath, "."], {
      cwd: tmpDir,
      stdio: "pipe",
    });

    fs.copyFileSync(profiles.machine, path.join(tmpDir, "machine.json"));
    fs.copyFileSync(profiles.process, path.join(tmpDir, "process.json"));
    fs.copyFileSync(profiles.filament, path.join(tmpDir, "filament.json"));

    return new Promise((resolve, reject) => {
      execFile(
        slicer,
        [
          "--allow-newer-file",
          "--no-check",
          "--load-settings",
          "machine.json;process.json",
          "--load-filaments",
          "filament.json",
          "--slice",
          "0",
          "--export-3mf",
          outFile,
          "patched.3mf",
        ],
        { cwd: tmpDir, timeout: 120000 },
        (error, _stdout, stderr) => {
          try {
            fs.rmSync(tmpDir, { recursive: true });
          } catch {}
          if (error) {
            reject(new Error(`Slicer failed: ${stderr || error.message}`));
            return;
          }
          if (!fs.existsSync(outFile)) {
            reject(new Error("Slicer produced no output file"));
            return;
          }
          resolve(outFile);
        },
      );
    });
  } catch (error: any) {
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {}
    throw error;
  }
}

export const tools: Tool[] = [
  {
    name: "slice_3mf",
    description:
      "Slice a 3MF file using OrcaSlicer CLI. Converts an unsliced 3MF (models + settings) " +
      "into a print-ready 3MF containing gcode. Uses P1S 0.4mm nozzle profiles by default. " +
      "If the file is already sliced, returns it unchanged.\n\n" +
      "REQUIRES: OrcaSlicer installed (brew install --cask orcaslicer)",
    inputSchema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "Path to the 3MF file to slice",
        },
        output_path: {
          type: "string",
          description:
            "Output path for sliced file (default: input_sliced.3mf)",
        },
      },
      required: ["input_path"],
    },
  },
];

export function createHandlers(
  _ctx: ToolContext,
): Record<string, (args: any) => Promise<any>> {
  return {
    slice_3mf: async (args: { input_path: string; output_path?: string }) => {
      const resolved = path.resolve(args.input_path);
      if (!fs.existsSync(resolved)) {
        return err(`File not found: ${resolved}`);
      }

      const alreadySliced = is3mfSliced(resolved);
      if (alreadySliced) {
        return ok({
          message: "File is already sliced (contains gcode)",
          path: resolved,
          sliced: false,
        });
      }

      const output = await slice3mf(resolved, args.output_path);
      return ok({
        message: "File sliced successfully",
        input: resolved,
        output,
        sliced: true,
      });
    },
  };
}

const slicerModule: ToolModule = { tools, createHandlers };
export default slicerModule;
