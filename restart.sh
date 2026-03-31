#!/bin/bash
# Restart the 2004Scape server without killing the browser
# Uses process name matching instead of port-based kill

SERVER_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Stopping server..."
pkill -f "tsx src/app" 2>/dev/null

# Wait for it to actually die
for i in {1..10}; do
    if ! pgrep -f "tsx src/app" > /dev/null 2>&1; then
        echo "Server stopped."
        break
    fi
    sleep 0.5
done

# Force kill if still running
if pgrep -f "tsx src/app" > /dev/null 2>&1; then
    echo "Force killing..."
    pkill -9 -f "tsx src/app" 2>/dev/null
    sleep 1
fi

echo "Starting server..."
cd "$SERVER_DIR"
npm start &
echo "Server starting in background (PID: $!)"
echo "Waiting for server to be ready..."

for i in {1..60}; do
    if curl -s http://localhost:8888 > /dev/null 2>&1; then
        echo "Server is ready at http://localhost:8888"
        exit 0
    fi
    sleep 2
done

echo "Warning: Server may still be starting up. Check logs."
