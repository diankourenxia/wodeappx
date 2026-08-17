#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
APP_NAME="${SHOPIFY_APP_NAME:-wodeappx-shopify-connector}"
SHOPIFY_CLIENT_ID="${SHOPIFY_CLIENT_ID:-}"
SHOPIFY_ORGANIZATION_ID="${SHOPIFY_ORGANIZATION_ID:-}"
SHOPIFY_AGENT_INFO="${SHOPIFY_CLI_AGENT_INFO:-n:Codex|v:1.0|p:OpenAI}"
SHOPIFY_AGENT_IDS="${SHOPIFY_CLI_AGENT_IDS:-s:wodeapp-shopify-connector|r:create-or-link|i:local}"

mkdir -p "$APP_DIR"

run_shopify() {
  SHOPIFY_CLI_AGENT_INFO="$SHOPIFY_AGENT_INFO" SHOPIFY_CLI_AGENT_IDS="$SHOPIFY_AGENT_IDS" shopify "$@"
}

if [[ -f "$APP_DIR/shopify.app.toml" ]]; then
  echo "Existing Shopify app config found: $APP_DIR/shopify.app.toml"
  run_shopify app config validate --json --path "$APP_DIR"
  exit 0
fi

if [[ -n "$SHOPIFY_CLIENT_ID" ]]; then
  echo "Linking existing Shopify app by Client ID."
  run_shopify app config link --path "$APP_DIR" --client-id "$SHOPIFY_CLIENT_ID" --no-color
  run_shopify app config validate --json --path "$APP_DIR"
  exit 0
fi

if [[ -n "$SHOPIFY_ORGANIZATION_ID" ]]; then
  echo "Linking existing Shopify app in organization $SHOPIFY_ORGANIZATION_ID."
  run_shopify app config link --path "$APP_DIR" --organization-id "$SHOPIFY_ORGANIZATION_ID" --no-color
  run_shopify app config validate --json --path "$APP_DIR"
  exit 0
fi

echo "Creating Shopify app project: $APP_NAME"
run_shopify app init \
  --name "$APP_NAME" \
  --path "$APP_DIR" \
  --template none \
  --package-manager pnpm \
  --no-color

echo
echo "Next:"
echo "1. Merge config/shopify.app.example.toml into app/shopify.app.toml if Shopify CLI generated a minimal config."
echo "2. Keep the generated client_id from the Shopify Dev Dashboard."
echo "3. Run: shopify app config validate --json --path $APP_DIR"
