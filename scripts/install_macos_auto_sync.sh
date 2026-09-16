#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
label="com.dallogix.trace.sync-master"
launch_agents_dir="${HOME}/Library/LaunchAgents"
plist_path="$launch_agents_dir/$label.plist"
template="$root_dir/deploy/macos/$label.plist"
uid="$(id -u)"

[[ -f "$template" ]] || { echo "Template do LaunchAgent não encontrado: $template" >&2; exit 1; }
command -v launchctl >/dev/null || { echo "launchctl não encontrado; este instalador é somente para macOS." >&2; exit 2; }
mkdir -p "$launch_agents_dir" "$root_dir/armazenamento/logs"

# O caminho da instalação é resolvido no momento da instalação para que o
# LaunchAgent não dependa de expansão de variáveis do launchd.
escaped_root="$(printf '%s' "$root_dir" | sed 's/[\\&|]/\\&/g')"
sed "s|__TRACE_ROOT__|$escaped_root|g" "$template" > "$plist_path"
chmod 600 "$plist_path"

launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist_path"
launchctl enable "gui/$uid/$label" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$uid/$label" >/dev/null 2>&1 || true
echo "Atualização automática instalada: $label"
echo "Verificação: launchctl print gui/$uid/$label"
