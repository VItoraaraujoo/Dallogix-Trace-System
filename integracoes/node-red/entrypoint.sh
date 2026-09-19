#!/bin/sh
set -eu

flow_file="/data/flows.json"
seed_flow="/seed/trace-clp-bridge.flow.json"
seed_modbus_flow="/seed/trace-modbus-duas-dalas.flow.json"

# A imagem cria um Flow 1 vazio na primeira inicialização. Troque somente esse
# placeholder; qualquer fluxo já configurado pelo operador é preservado.
if [ ! -f "$flow_file" ] || {
    grep -Eq '"label"[[:space:]]*:[[:space:]]*"Flow 1"' "$flow_file" &&
    ! grep -q '"id"[[:space:]]*:[[:space:]]*"trace-clp-bridge"' "$flow_file";
}; then
    if [ -f "$seed_modbus_flow" ]; then
        /usr/local/bin/node -e '
const fs = require("fs");
const output = process.argv[1];
const files = process.argv.slice(2);
const flows = files.flatMap((file) => JSON.parse(fs.readFileSync(file, "utf8")));
fs.writeFileSync(output, JSON.stringify(flows));
' "$flow_file" "$seed_flow" "$seed_modbus_flow"
    else
        cp "$seed_flow" "$flow_file"
    fi
fi

if [ -n "${FLOWS:-}" ]; then
    set -- "$FLOWS" "$@"
fi

exec /usr/local/bin/node ${NODE_OPTIONS:-} node_modules/node-red/red.js --userDir /data "$@"
