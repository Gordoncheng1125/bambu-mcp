import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

const SECRETS_DIR = path.join(os.homedir(), ".bambu-mcp");
const SECRETS_FILE = path.join(SECRETS_DIR, "secrets.enc");
const ALGORITHM = "aes-256-gcm";
const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;

interface EncryptedStore {
  iv: string;
  salt: string;
  tag: string;
  data: string;
}

function getMasterPassword(): string | null {
  // 1. Environment variable
  const envPw = process.env.BAMBU_MCP_MASTER_PASSWORD;
  if (envPw) return envPw;

  // 2. macOS Keychain
  try {
    const pw = execFileSync(
      "security",
      [
        "find-generic-password",
        "-s",
        "bambu-mcp-secrets",
        "-a",
        "master",
        "-w",
      ],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (pw) return pw;
  } catch {
    // Keychain entry not found
  }

  return null;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    "sha512",
  );
}

export function loadSecrets(): Record<string, string> {
  const masterPw = getMasterPassword();
  if (!masterPw) return {};

  if (!fs.existsSync(SECRETS_FILE)) return {};

  try {
    const raw = fs.readFileSync(SECRETS_FILE, "utf-8");
    const store: EncryptedStore = JSON.parse(raw);

    const salt = Buffer.from(store.salt, "hex");
    const iv = Buffer.from(store.iv, "hex");
    const tag = Buffer.from(store.tag, "hex");
    const encrypted = Buffer.from(store.data, "hex");

    const key = deriveKey(masterPw, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf-8"));
  } catch {
    console.error(
      "[bambu-mcp] Failed to decrypt secrets store — falling back to env vars",
    );
    return {};
  }
}

export function saveSecrets(secrets: Record<string, string>): void {
  const masterPw = getMasterPassword();
  if (!masterPw) {
    throw new Error(
      "No master password configured. Set BAMBU_MCP_MASTER_PASSWORD or add to macOS Keychain.",
    );
  }

  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterPw, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const store: EncryptedStore = {
    iv: iv.toString("hex"),
    salt: salt.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };

  fs.writeFileSync(SECRETS_FILE, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

let cachedSecrets: Record<string, string> | null = null;

export function getSecret(key: string): string | undefined {
  // Lazy-load encrypted store
  if (cachedSecrets === null) {
    cachedSecrets = loadSecrets();
  }

  // Encrypted store first, then env var
  return cachedSecrets[key] ?? process.env[key] ?? undefined;
}
