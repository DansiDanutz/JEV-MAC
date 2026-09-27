#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ ! -d node_modules ]]; then
  npm ci
fi
if [[ ! -f native/fsops || ! -f dist/index.html ]]; then
  npm run build
fi
if [[ -z "${JEV_MAC_KEY_FILE:-}" && -f "${HOME}/.jev-router.env" ]]; then
  export JEV_MAC_KEY_FILE="${HOME}/.jev-router.env"
fi
mkdir -p runtime
chmod 700 runtime
if [[ -f runtime/daemon.lock ]] && kill -0 "$(<runtime/daemon.lock)" 2>/dev/null; then
  if node --import tsx src/cli.ts status >/dev/null 2>&1; then
    open runtime/launch.html
    exit 0
  fi
  print 'An existing daemon lock is live but the service is unreachable. Inspect it before restarting.'
  exit 1
fi
node --import tsx src/server.ts &
jev_mac_launcher_pid=$!
trap 'kill "$jev_mac_launcher_pid" 2>/dev/null || true' EXIT INT TERM
for jev_mac_attempt in {1..100}; do
  if [[ -f runtime/daemon.lock && -f runtime/launch.html ]] && node --import tsx src/cli.ts status >/dev/null 2>&1; then
    open runtime/launch.html
    print 'JEV-MAC is running. Keep this terminal open; Control-C stops the service.'
    wait "$jev_mac_launcher_pid"
    exit $?
  fi
  kill -0 "$jev_mac_launcher_pid" 2>/dev/null || { wait "$jev_mac_launcher_pid"; exit $?; }
  sleep 0.1
done
print 'Startup timed out. Inspect this terminal for the cause.'
exit 1
