const sensitiveValues = new Set<string>();

export function registerSensitiveValue(value: string): void {
  if (value && value.length >= 4) {
    sensitiveValues.add(value);
  }
}

export function initRedaction(): void {
  const keys = [
    "BAMBU_LAB_COOKIES",
    "BAMBU_LAB_MQTT_PASSWORD",
    "BAMBU_LAB_MQTT_HOST",
    "BAMBU_LAB_DEVICE_ID",
    "BAMBU_MCP_MASTER_PASSWORD",
    "AZURE_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ];

  for (const key of keys) {
    const val = process.env[key];
    if (val) registerSensitiveValue(val);
  }
}

export function redactOutput(text: string): string {
  let result = text;
  for (const value of sensitiveValues) {
    if (result.includes(value)) {
      result = result.split(value).join("[REDACTED]");
    }
  }
  return result;
}
