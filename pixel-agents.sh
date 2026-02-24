#!/bin/bash
# Run Pixel Agents from anywhere
# Usage: ./pixel-agents.sh [dev|build|start|install]

SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd "$(dirname "$SOURCE")" && pwd)"

case "${1:-start}" in
  install)
    echo "Installing dependencies..."
    (cd "$DIR" && npm install)
    (cd "$DIR/server" && npm install)
    (cd "$DIR/webview-ui" && npm install)
    ;;
  build)
    echo "Building..."
    (cd "$DIR" && npm run build)
    ;;
  start)
    echo "Building and starting production server..."
    (cd "$DIR" && npm run build && node server/dist/index.js --cwd "$DIR")
    ;;
  dev)
    echo "Starting dev server..."
    (cd "$DIR" && npm run dev)
    ;;
  *)
    echo "Usage: pixel-agents [dev|build|start|install]"
    echo "  start   - Build and start production server (default)"
    echo "  dev     - Start dev server"
    echo "  build   - Build for production"
    echo "  install - Install all dependencies"
    exit 1
    ;;
esac
