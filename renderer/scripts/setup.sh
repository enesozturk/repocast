#!/usr/bin/env bash
# One-time setup for a new machine. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ installing dependencies"
pnpm install

# Remotion renders in a headless Chrome it manages itself. Pull it now rather
# than on the first render, where a slow download looks like a hang.
echo "→ ensuring the headless browser"
npx remotion browser ensure

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ created .env — add your ELEVENLABS_API_KEY before rendering with voice"
fi

echo
echo "Done. Try it:"
echo "  node --experimental-strip-types src/cli.ts layout examples/example.system-map.json"
echo "  node --experimental-strip-types src/cli.ts voice  examples/example.script.json --silent"
echo "  node --experimental-strip-types src/cli.ts render examples/example.system-map.json examples/example.script.json"
