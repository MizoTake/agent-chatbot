#!/usr/bin/env bash
# opencode-monitor.sh
#
# Wrapper for opencode-cli.
# Periodically checks the LMStudio API and kills the process if it becomes unresponsive.
#
# Environment variables:
#   LMSTUDIO_URL             LMStudio API URL (default: http://localhost:1234)
#   OPENCODE_CHECK_INTERVAL  Check interval in seconds (default: 30)
#   OPENCODE_FAIL_THRESHOLD  Consecutive failures before timeout (default: 3 = 90s)
#
# Usage (orcha.yml):
#   command: "bash"
#   args: ["scripts/opencode-monitor.sh", "run", "--thinking"]

set -uo pipefail
export LANG=C.UTF-8
export LC_ALL=C.UTF-8

LMSTUDIO_URL="${LMSTUDIO_URL:-http://localhost:1234}"
CHECK_INTERVAL="${OPENCODE_CHECK_INTERVAL:-30}"
FAIL_THRESHOLD="${OPENCODE_FAIL_THRESHOLD:-3}"

opencode_pid=""
watchdog_pid=""

cleanup() {
  [ -n "${watchdog_pid}" ] && kill "${watchdog_pid}" 2>/dev/null || true
  [ -n "${opencode_pid}" ] && kill "${opencode_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Check LMStudio API health
check_lmstudio() {
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${LMSTUDIO_URL}/v1/models" 2>/dev/null)

  # 401: LMStudio is running but requires auth token - let opencode-cli handle auth
  if [[ "${http_code}" == "401" ]]; then
    echo "[opencode-monitor] LMStudio is running (auth required, delegating to opencode-cli)" >&2
    return 0
  fi

  # Not reachable
  if [[ "${http_code}" != "200" ]]; then
    return 1
  fi

  # 200: Check if at least one model is loaded
  local response
  response=$(curl -s --max-time 10 "${LMSTUDIO_URL}/v1/models" 2>/dev/null)
  local model_count
  model_count=$(printf '%s' "${response}" | grep -c '"id"' || true)
  if (( model_count == 0 )); then
    echo "[opencode-monitor] WARNING: No models loaded in LMStudio" >&2
    return 1
  fi

  return 0
}

# Watchdog: periodically check LMStudio API
watchdog_loop() {
  local fail_count=0

  while true; do
    sleep "${CHECK_INTERVAL}"

    # Stop watching if opencode-cli has already exited
    if ! kill -0 "${opencode_pid}" 2>/dev/null; then
      break
    fi

    if check_lmstudio; then
      echo "[opencode-monitor] LMStudio OK (${LMSTUDIO_URL}/v1/models, consecutive failures: ${fail_count}->0)" >&2
      fail_count=0
    else
      (( fail_count++ ))
      echo "[opencode-monitor] LMStudio not responding (${fail_count}/${FAIL_THRESHOLD})" >&2
      if (( fail_count >= FAIL_THRESHOLD )); then
        echo "[opencode-monitor] LMStudio failed ${fail_count} times consecutively -> killing opencode-cli" >&2
        kill "${opencode_pid}" 2>/dev/null || true
        exit 1
      fi
    fi
  done
}

# Check LMStudio status before starting
echo "[opencode-monitor] Checking LMStudio... (${LMSTUDIO_URL})" >&2
if ! check_lmstudio; then
  echo "[opencode-monitor] ERROR: LMStudio is not running or no models are loaded" >&2
  # Output to stdout as well so the caller gets a valid UTF-8 response instead of an empty stream
  echo "ERROR: LMStudio is not running or no models are loaded at ${LMSTUDIO_URL}. Please start LMStudio and load a model before running."
  exit 1
fi
echo "[opencode-monitor] LMStudio OK" >&2

# Launch opencode-cli with stdin closed so it runs non-interactively
opencode-cli "$@" </dev/null &
opencode_pid=$!
echo "[opencode-monitor] opencode-cli started (pid=${opencode_pid})" >&2

# Start watchdog
watchdog_loop &
watchdog_pid=$!

# Wait for opencode-cli to finish
wait "${opencode_pid}" 2>/dev/null
opencode_exit=$?

kill "${watchdog_pid}" 2>/dev/null || true
exit "${opencode_exit}"
