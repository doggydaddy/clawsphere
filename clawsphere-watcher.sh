#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/doggydaddy/.openclaw/workspace/clawsphere"
INPUT_DIR="$ROOT/speech2txt/input"
STATE_DIR="$ROOT/state"
LOG_FILE="$STATE_DIR/clawsphere-watcher.log"
PID_FILE="$STATE_DIR/clawsphere-watcher.pid"
POLL_SECONDS=5

mkdir -p "$INPUT_DIR" "$STATE_DIR"
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

echo "[$(date --iso-8601=seconds)] clawsphere watcher started" >> "$LOG_FILE"

while true; do
  shopt -s nullglob
  for file in "$INPUT_DIR"/*_mic.txt; do
    [ -f "$file" ] || continue
    if [ ! -s "$file" ]; then
      mv "$file" "${file%.txt}.mic.done"
      echo "[$(date --iso-8601=seconds)] marked empty transcript handled: $(basename "$file")" >> "$LOG_FILE"
      continue
    fi

    echo "[$(date --iso-8601=seconds)] pending transcript: $(basename "$file")" >> "$LOG_FILE"
  done
  shopt -u nullglob
  sleep "$POLL_SECONDS"
done
