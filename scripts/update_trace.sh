#!/usr/bin/env bash
set -euo pipefail

# Atualiza uma instalação local somente quando não há carregamento em andamento.
# O servidor de atualização publica um manifesto assinado e um pacote imutável.
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$root_dir/.env" ]]; then
  set -a
  # O .env é criado pelo administrador e já é usado pelo Compose.
  . "$root_dir/.env"
  set +a
fi

manifest_url="${UPDATE_MANIFEST_URL:-}"
public_key="${UPDATE_PUBLIC_KEY_FILE:-}"
channel="${UPDATE_CHANNEL:-stable}"
dry_run="${TRACE_UPDATE_DRY_RUN:-0}"
if [[ -z "$manifest_url" || -z "$public_key" ]]; then
  echo "Atualização remota não configurada: defina UPDATE_MANIFEST_URL e UPDATE_PUBLIC_KEY_FILE." >&2
  exit 2
fi
[[ "$manifest_url" == https://* ]] || { echo "O manifesto remoto deve usar HTTPS." >&2; exit 3; }
[[ -f "$public_key" ]] || { echo "Chave pública não encontrada: $public_key" >&2; exit 4; }

command -v curl >/dev/null || { echo "curl é necessário." >&2; exit 5; }
command -v openssl >/dev/null || { echo "openssl é necessário para verificar a assinatura." >&2; exit 6; }
command -v python3 >/dev/null || { echo "python3 é necessário para validar o manifesto." >&2; exit 7; }

state_dir="$root_dir/armazenamento/updates"
mkdir -p "$state_dir/releases" "$state_dir/backups"
lock_dir="$state_dir/.install.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Já existe uma atualização em execução." >&2
  exit 8
fi
cleanup() {
  rmdir "$lock_dir" 2>/dev/null || true
  if [[ -n "${work_dir:-}" ]]; then rm -rf -- "$work_dir"; fi
}
trap cleanup EXIT
work_dir="$(mktemp -d "$state_dir/.staging.XXXXXX")"
manifest="$work_dir/manifest.json"
headers=()
if [[ -n "${UPDATE_MANIFEST_TOKEN:-}" ]]; then headers+=( -H "Authorization: Bearer ${UPDATE_MANIFEST_TOKEN}" ); fi
curl --fail --silent --show-error --location --max-time 20 "${headers[@]}" "$manifest_url" -o "$manifest"

mapfile -t fields < <(python3 - "$manifest" "$channel" <<'PY'
import json, pathlib, sys
data = json.loads(pathlib.Path(sys.argv[1]).read_text())
channel = sys.argv[2]
if data.get("channel", channel) != channel:
    raise SystemExit("manifesto de canal diferente do configurado")
required = ("version", "artifact_url", "sha256", "signature")
if any(not isinstance(data.get(k), str) or not data[k].strip() for k in required):
    raise SystemExit("manifesto sem campos obrigatórios")
if not data["artifact_url"].startswith("https://"):
    raise SystemExit("artefato remoto deve usar HTTPS")
if len(data["sha256"]) != 64 or any(c not in "0123456789abcdefABCDEF" for c in data["sha256"]):
    raise SystemExit("SHA-256 inválido")
print(data["version"])
print(data["artifact_url"])
print(data["sha256"].lower())
print(data["signature"])
PY
)
version="${fields[0]}"; artifact_url="${fields[1]}"; expected_sha="${fields[2]}"; signature_b64="${fields[3]}"
[[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Versão inválida." >&2; exit 9; }
printf '%s\n%s\n%s\n' "$version" "$artifact_url" "$expected_sha" > "$work_dir/payload"
python3 - "$signature_b64" "$work_dir/signature.bin" <<'PY'
import base64, pathlib, sys
pathlib.Path(sys.argv[2]).write_bytes(base64.b64decode(sys.argv[1], validate=True))
PY
openssl dgst -sha256 -verify "$public_key" -signature "$work_dir/signature.bin" "$work_dir/payload" >/dev/null || {
  echo "Assinatura do pacote rejeitada." >&2; exit 10;
}

active="$(docker compose exec -T mysql mysql -N -B -utrace -p"${MYSQL_PASSWORD:-change-me-local}" "${MYSQL_DATABASE:-trace_local}" -e "SELECT COUNT(*) FROM carregamentos WHERE state IN ('PREPARANDO','CARREGANDO','PAUSADO','FINALIZANDO','EMERGENCIA');" 2>/dev/null | tr -d '[:space:]' || true)"
if [[ "${active:-0}" != "0" ]]; then
  echo "Atualização adiada: existe carregamento ativo ou em estado de intervenção." >&2
  exit 11
fi

if [[ -f "$state_dir/current_version" && "$(cat "$state_dir/current_version")" == "$version" ]]; then
  echo "Trace já está na versão $version."
  exit 0
fi

artifact="$work_dir/trace-$version.tar.gz"
curl --fail --silent --show-error --location --max-time 120 "${headers[@]}" "$artifact_url" -o "$artifact"
if command -v sha256sum >/dev/null; then
  actual_sha="$(sha256sum "$artifact" | awk '{print tolower($1)}')"
else
  actual_sha="$(shasum -a 256 "$artifact" | awk '{print tolower($1)}')"
fi
[[ "$actual_sha" == "$expected_sha" ]] || { echo "Integridade do pacote rejeitada." >&2; exit 12; }
tar -tzf "$artifact" >/dev/null
if [[ "$dry_run" == "1" ]]; then
  echo "Manifesto, assinatura e integridade válidos para $version (simulação; nada foi alterado)."
  exit 0
fi

backup="$state_dir/backups/pre-$version-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
bash "$root_dir/scripts/backup_db.sh"
tar --exclude='./.env' --exclude='./armazenamento' --exclude='./.git' -czf "$backup" -C "$root_dir" .
release_dir="$state_dir/releases/$version"
rm -rf "$release_dir"
mkdir -p "$release_dir"
tar -xzf "$artifact" -C "$release_dir" --no-same-owner
source_dir="$release_dir"
if [[ -d "$release_dir/trace" && -f "$release_dir/trace/docker-compose.yml" ]]; then source_dir="$release_dir/trace"; fi
[[ -f "$source_dir/docker-compose.yml" ]] || { echo "Pacote sem docker-compose.yml." >&2; exit 13; }

docker compose stop >/dev/null
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude='.env' --exclude='armazenamento/' --exclude='.git/' "$source_dir/" "$root_dir/"
else
  echo "rsync é necessário para uma instalação segura." >&2
  exit 14
fi
docker compose up -d --build >/dev/null
healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:${PHP_PORT:-8080}/api/health.php >/dev/null; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  echo "A versão $version não passou no healthcheck; iniciando rollback." >&2
  docker compose stop >/dev/null || true
  tar -xzf "$backup" -C "$root_dir" --no-same-owner
  docker compose up -d --build >/dev/null
  exit 15
fi
printf '%s\n' "$version" > "$state_dir/current_version"
echo "Trace atualizado com sucesso para $version. Backup: $backup"
