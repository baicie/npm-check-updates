#!/bin/bash
# Build then link this package globally and ensure the bin is executable
set -e

echo "Building @baicie/ncu..."
npm run build

echo "Linking @baicie/ncu..."
npm link

# Ensure the bin file is executable (can be lost after rebuild)
BIN_PATH="$(npm root -g)/@baicie/ncu/dist/cjs/cli.cjs"
if [ -f "$BIN_PATH" ]; then
  chmod +x "$BIN_PATH"
  echo "Made $BIN_PATH executable"
fi

echo "Done. Run 'ncu' to use."
