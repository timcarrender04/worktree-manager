#!/usr/bin/env bash

set -euo pipefail

PORT="${DEV_PORT:-3334}"

get_pids() {
  local port="$1"
  local -a found=()

  if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r pid; do
      if [[ -n "${pid}" ]]; then
        found+=("${pid}")
      fi
    done < <(lsof -ti tcp:"${port}" -sTCP:LISTEN 2>/dev/null || true)
  fi

  if [[ ${#found[@]} -eq 0 ]] && command -v ss >/dev/null 2>&1; then
    while IFS= read -r line; do
      pid=$(grep -o 'pid=[0-9]*' <<<"${line}" | cut -d= -f2)
      if [[ -n "${pid}" ]]; then
        found+=("${pid}")
      fi
    done < <(ss -H -tnlp "sport = :${port}" 2>/dev/null || true)
  fi

  if [[ ${#found[@]} -eq 0 ]] && command -v fuser >/dev/null 2>&1; then
    while IFS= read -r pid; do
      if [[ -n "${pid}" ]]; then
        found+=("${pid}")
      fi
    done < <(fuser -n tcp "${port}" 2>/dev/null || true)
  fi

  printf '%s\n' "${found[@]}" | sort -u
}

pids_to_kill=($(get_pids "${PORT}")) || pids_to_kill=()

if [[ ${#pids_to_kill[@]} -eq 0 ]]; then
  echo "[predev] Port ${PORT} is free."
  exit 0
fi

echo "[predev] Port ${PORT} is in use. Attempting to terminate offending process(es)..."

for pid in "${pids_to_kill[@]}"; do
  if ps -p "${pid}" >/dev/null 2>&1; then
    process_cmd=$(ps -o cmd= -p "${pid}" || true)
    echo "[predev] Sending SIGTERM to PID ${pid} (${process_cmd})."
    kill "${pid}" || true
  fi
done

sleep 1

remaining_pids=($(get_pids "${PORT}")) || remaining_pids=()

if [[ ${#remaining_pids[@]} -eq 0 ]]; then
  echo "[predev] Port ${PORT} cleared."
  exit 0
fi

echo "[predev] Port ${PORT} still in use. Escalating to SIGKILL..."

for pid in "${remaining_pids[@]}"; do
  if ps -p "${pid}" >/dev/null 2>&1; then
    process_cmd=$(ps -o cmd= -p "${pid}" || true)
    echo "[predev] Sending SIGKILL to PID ${pid} (${process_cmd})."
    kill -9 "${pid}" || true
  fi
done

sleep 1

final_pids=($(get_pids "${PORT}")) || final_pids=()

if [[ ${#final_pids[@]} -gt 0 ]]; then
  echo "[predev] Warning: Unable to free port ${PORT}. Remaining PIDs: ${final_pids[*]}"
else
  echo "[predev] Port ${PORT} cleared."
fi

exit 0

