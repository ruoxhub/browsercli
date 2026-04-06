#!/bin/bash
# Daemon startup wrapper for tests
# This script properly detaches the daemon process

DAEMON_SCRIPT="$1"
BROWSER_URL="$2"

if [ -z "$DAEMON_SCRIPT" ] || [ -z "$BROWSER_URL" ]; then
  echo "Usage: $0 <daemon-script> <browser-url>"
  exit 1
fi

# Create a temp file to capture output
TEMP_OUTPUT=$(mktemp)

# Use nohup to fully detach and redirect output to temp file
nohup node "$DAEMON_SCRIPT" --browserUrl "$BROWSER_URL" > "$TEMP_OUTPUT" 2>&1 &
DAEMON_PID=$!

# Wait a moment for daemon to check existing instance
sleep 1

# Check if daemon process is still running
if ! kill -0 $DAEMON_PID 2>/dev/null; then
  # Process exited, check output for error
  if cat "$TEMP_OUTPUT" | grep -q "已经在运行"; then
    echo "Daemon already running"
    rm -f "$TEMP_OUTPUT"
    exit 1
  fi
fi

# Daemon is running, clean up temp file
rm -f "$TEMP_OUTPUT"
exit 0
