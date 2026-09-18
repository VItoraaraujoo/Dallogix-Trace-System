#!/bin/sh
set -eu

flow_file="/data/flows.json"
seed_flow="/seed/trace-clp-bridge.flow.json"

# A imagem cria um Flow 1 vazio na primeira inicialização. Troque somente esse
# placeholder; qualquer fluxo já configurado pelo operador é preservado.
if [ ! -f "$flow_file" ] || {
    grep -Eq '"label"[[:space:]]*:[[:space:]]*"Flow 1"' "$flow_file" &&
    ! grep -q '"id"[[:space:]]*:[[:space:]]*"trace-clp-bridge"' "$flow_file";
}; then
    cp "$seed_flow" "$flow_file"
fi

if [ -n "${FLOWS:-}" ]; then
    set -- "$FLOWS" "$@"
fi

exec /usr/local/bin/node ${NODE_OPTIONS:-} node_modules/node-red/red.js --userDir /data "$@"
