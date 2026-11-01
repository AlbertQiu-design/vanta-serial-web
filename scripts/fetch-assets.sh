#!/usr/bin/env bash
# 从 Figma MCP 导出 URL 拉取设计稿图片（约 7 天有效，可定期重跑）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/assets"
mkdir -p "$ASSETS"
CURSOR_ASSETS="${HOME}/.cursor/projects/Users-albertsmacbookpro-Downloads-Vanta-Code/assets"
CURSOR_ASSETS_ESC="${HOME}/.cursor/projects/Users-albertsmacbookpro-Downloads-Vanta-Code-esp32-esc-test/assets"

curl -fsSL -o "$ASSETS/gauge-arc.png" \
  "https://www.figma.com/api/mcp/asset/ea8b4ca5-5d2d-4d86-b0c7-f3083170a807" || true
curl -fsSL -o "$ASSETS/vid-btn-camera.png" \
  "https://www.figma.com/api/mcp/asset/4e6c5a7d-7e93-4939-97d5-953833be55df" || true
curl -fsSL -o "$ASSETS/vid-btn-record.png" \
  "https://www.figma.com/api/mcp/asset/b6fae352-6e46-4293-9a62-94372cc5f349" || true
curl -fsSL -o "$ASSETS/vid-btn-mic-off.png" \
  "https://www.figma.com/api/mcp/asset/8a1c3e2b-70c8-44ab-9a3a-5fe20d24da86" || true

if [[ -f "$CURSOR_ASSETS/Group_275-3122455e-346e-40ed-82d0-8067660dd5f7.png" ]]; then
  cp "$CURSOR_ASSETS/Group_275-3122455e-346e-40ed-82d0-8067660dd5f7.png" "$ASSETS/vanta-logo.png"
fi
if [[ -f "$CURSOR_ASSETS_ESC/____3_3-3b186032-f498-4790-891e-14aff4fa87f2.png" ]]; then
  cp "$CURSOR_ASSETS_ESC/____3_3-3b186032-f498-4790-891e-14aff4fa87f2.png" "$ASSETS/rov-hero.png"
elif [[ -f "$CURSOR_ASSETS/image-8fd34e0c-9b10-4f7a-95c5-cfe70289257f.png" ]]; then
  cp "$CURSOR_ASSETS/image-8fd34e0c-9b10-4f7a-95c5-cfe70289257f.png" "$ASSETS/rov-hero.png"
fi

echo "OK: $ASSETS"
