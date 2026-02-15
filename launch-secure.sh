#!/usr/bin/env bash
# Launch bambu-lab-mcp with secrets from macOS Keychain
# All secrets stored under service "bambu-lab-mcp"

kc() { security find-generic-password -s "bambu-lab-mcp" -a "$1" -w 2>/dev/null; }

export BAMBU_LAB_MQTT_HOST="$(kc mqtt-host)"
export BAMBU_LAB_MQTT_PASSWORD="$(kc mqtt-password)"
export BAMBU_LAB_DEVICE_ID="$(kc device-id)"
export AZURE_OPENAI_API_KEY="$(kc azure-openai-api-key)"
export AZURE_OPENAI_ENDPOINT="https://openai-qrg-sandbox-experiment.cognitiveservices.azure.com"
export AZURE_OPENAI_DEPLOYMENT="qrg-gpt-4.1-mini"
export AZURE_OPENAI_API_VERSION="2025-01-01-preview"

exec node "$(dirname "$0")/dist/index.js"
