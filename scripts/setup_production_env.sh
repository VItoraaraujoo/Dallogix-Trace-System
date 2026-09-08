#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_PATH="$ROOT_DIR/.env.production.example"
TARGET_PATH="$ROOT_DIR/.env"

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "ERRO: template de produção não encontrado em $TEMPLATE_PATH" >&2
  exit 1
fi

if [[ -f "$TARGET_PATH" ]]; then
  echo "OK: $TARGET_PATH já existe; nenhuma alteração foi feita."
  exit 0
fi

python3 - "$TEMPLATE_PATH" "$TARGET_PATH" <<'PY'
import os
import secrets
import string
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])

alphabet = string.ascii_letters + string.digits

def gen_token(length=32):
    return "".join(secrets.choice(alphabet) for _ in range(length))

lines = src.read_text(encoding='utf-8').splitlines()
replacements = {
    "APP_ENV": "production",
    "TZ": "America/Sao_Paulo",
    "SESSION_SECURE": "true",
    "WEB_BIND_ADDRESS": "127.0.0.1",
    "BIND_ADDRESS": "127.0.0.1",
    "APP_URL": "https://trace.dallogix.local",
    "MYSQL_DATABASE": "trace_prod",
    "MYSQL_USER": "trace_prod",
    "MYSQL_PASSWORD": gen_token(32),
    "MYSQL_ROOT_PASSWORD": gen_token(40),
    "SYNC_REMOTE_URL": "",
    "SYNC_REMOTE_TOKEN": "",
    "UPDATE_MANIFEST_URL": "",
    "UPDATE_MANIFEST_TOKEN": "",
    "UPDATE_PUBLIC_KEY_FILE": "",
    "UPDATE_CHANNEL": "stable",
    "CAMERA_INTERNAL_TOKEN": gen_token(32),
    "PLC_INTERNAL_TOKEN": gen_token(32),
    "LOGIN_EMAIL_DOMAIN": "dallogix.local",
    "CAMERA_CAPTURE_URL": "https://camera.dallogix.local",
    "IMAGE_RETENTION_DAYS": "30",
    "TRACE_BACKUP_RETENTION_DAYS": "30",
    "MYSQL_PORT": "3306",
    "PHP_PORT": "8080",
    "NODE_RED_PORT": "1880",
    "TRACE_MACHINE_ID": "EST-001",
    "TRACE_DEBOUNCE_MS": "400",
    "PLC_PROTOCOL": "modbus-tcp",
    "MODBUS_VIRTUAL_HOST": "modbus-virtual",
    "MODBUS_VIRTUAL_PORT": "1502",
    "PLC_IP": "10.0.0.25",
    "PLC_PORT": "502",
    "PLC_EXTERNAL_PORT": "",
    "PLC_SERIAL_PORT": "/dev/ttyUSB0",
    "PLC_BAUD_RATE": "9600",
    "PLC_DATA_BITS": "7",
    "PLC_PARITY": "even",
    "PLC_STOP_BITS": "1",
    "PLC_STATION_ID": "1",
    "SCANNER_INTERFACE": "serial",
    "SCANNER_SERIAL_PORT": "/dev/ttyUSB1",
    "SCANNER_BAUD_RATE": "9600",
    "SCANNER_TERMINATOR": "CRLF",
}

rendered = []
for line in lines:
    if not line or line.startswith("#"):
        rendered.append(line)
        continue
    if "=" not in line:
        rendered.append(line)
        continue
    key, _, _ = line.partition("=")
    rendered.append(f"{key}={replacements.get(key, '')}")

dst.write_text("\n".join(rendered) + "\n", encoding='utf-8')
PY

echo "OK: arquivo .env criado com valores seguros gerados localmente."
echo "Revise os valores antes do deploy em ambiente real."
