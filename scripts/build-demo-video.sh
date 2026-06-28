#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/scripts/demo-cli.webm"
BROWSER="$ROOT/runtime/reports/videos/automationexercise_add_to_cart.mp4"
OUT="$ROOT/resources/assets/demo.webpilot.mp4"
GIF="$ROOT/resources/assets/demo.webpilot.gif"

cd "$ROOT/scripts"
vhs demo-cli.tape

# CLI: skip shell setup typing; browser: hold 3.2s so agent starts when Step 1 logs
ffmpeg -y \
  -ss 1.1 -t 28.5 -i "$CLI" \
  -t 28.5 -i "$BROWSER" \
  -filter_complex "\
[0:v]scale=1280:420:force_original_aspect_ratio=decrease,pad=1280:420:(ow-iw)/2:(oh-ih)/2:color=0x11111b,setsar=1[top];\
[1:v]tpad=start_duration=3.2:start_mode=add:color=0x11111b,scale=1280:700:force_original_aspect_ratio=decrease,pad=1280:700:(ow-iw)/2:(oh-ih)/2:color=0x11111b,setsar=1[bot];\
[top][bot]vstack=inputs=2[v]" \
  -map "[v]" -c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "$OUT"

ffmpeg -y -i "$OUT" -t 24 -vf "fps=8,scale=640:-1:flags=lanczos" "$GIF"
ffmpeg -y -i "$OUT" -vframes 1 -update 1 "$ROOT/resources/assets/demo.webpilot.poster.png"

echo "Built $OUT ($(ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 "$OUT"))"
