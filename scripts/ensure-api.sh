#!/bin/bash
# Ensures SoterFlow API is running. Use with cron or launchd.
PIDFILE="/tmp/soterflow-api.pid"
LOGFILE="/tmp/soterflow-api.log"
DIR="/Users/egorsoter/soter/soterflow"

# Check if API is responding
if curl -sf http://localhost:3847/api/health > /dev/null 2>&1; then
  exit 0
fi

echo "[$(date)] SoterFlow API is down, restarting..." >> "$LOGFILE"
cd "$DIR" || exit 1
nohup npx tsx src/api/start.ts >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
echo "[$(date)] Restarted with PID $!" >> "$LOGFILE"
