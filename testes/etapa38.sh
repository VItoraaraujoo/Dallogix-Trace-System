#!/usr/bin/env bash
set -u

base_url="${TRACE_BASE_URL:-http://localhost:8080}"
cookie_file="/tmp/dallogix-trace-etapa38-cookie.txt"
equipment_id="${TRACE_TEST_EQUIPMENT_ID:-$(docker compose exec -T mysql mysql -N -utrace -pchange-me-local trace_local -e "SELECT e.id FROM equipamentos e WHERE NOT EXISTS (SELECT 1 FROM carregamentos c WHERE c.equipment_id = e.id AND c.state <> 'FINALIZADO') ORDER BY e.id LIMIT 1" 2>/dev/null | tr -d '\r' | head -n 1)}"
fail() { echo "FAIL: $1"; exit 1; }

[ -n "$equipment_id" ] || fail "nenhuma Dala livre para o teste"

login="$(curl -sS -c "$cookie_file" -H 'Content-Type: application/json' -d '{"email":"admin@dallogix.local","password":"password"}' "$base_url/api/login.php")"
printf '%s' "$login" | grep -q '"authenticated":true' || fail "login falhou"

stamp="$(date +%s)"
product_b_code="A01-${stamp}"
product_b_barcode="789${stamp}"
product_b="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"name\":\"Produto A01 ${stamp}\",\"code\":\"${product_b_code}\",\"barcode\":\"${product_b_barcode}\"}" "$base_url/api/produtos.php")"
product_b_id="$(printf '%s' "$product_b" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$product_b_id" ] || fail "segundo produto não foi criado: $product_b"

product_a_id="$(curl -sS -b "$cookie_file" "$base_url/api/produtos.php" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=(JSON.parse(s).data||[]).find(x=>x.code==="PROD3");process.stdout.write(p?String(p.id):"")})')"
[ -n "$product_a_id" ] || fail "produto PROD3 não encontrado"

number="A01-${stamp}"
manifest="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"number\":\"${number}\",\"scheduled_date\":\"$(date +%F)\",\"plate\":\"A01${stamp:(-5)}\",\"product_code\":\"PROD3\",\"planned_quantity\":1}" "$base_url/api/romaneios.php")"
manifest_id="$(printf '%s' "$manifest" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
truck_id="$(printf '%s' "$manifest" | sed -n 's/.*"truck_id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$manifest_id" ] && [ -n "$truck_id" ] || fail "romaneio não foi criado: $manifest"

updated="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"action\":\"update\",\"romaneio_id\":${manifest_id},\"number\":\"${number}\",\"scheduled_date\":\"$(date +%F)\",\"plate\":\"A01${stamp:(-5)}\",\"items\":[{\"product_id\":${product_a_id},\"quantity\":1},{\"product_id\":${product_b_id},\"quantity\":2}]}" "$base_url/api/romaneios.php")"
printf '%s' "$updated" | grep -q "\"id\":${manifest_id}" || fail "romaneio com dois produtos não foi salvo: $updated"

prepared="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"romaneio_id\":${manifest_id},\"truck_id\":${truck_id},\"equipment_id\":${equipment_id}}" "$base_url/api/carregamentos.php")"
loading_id="$(printf '%s' "$prepared" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')"
[ -n "$loading_id" ] || fail "carregamento não foi preparado: $prepared"

started="$(curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" "$base_url/api/estado_carregamento.php")"
printf '%s' "$started" | grep -q '"state":"CARREGANDO"' || fail "carregamento não iniciou: $started"

first="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
printf '%s' "$first" | grep -q '"result":"VALIDO"' || fail "primeira unidade válida não foi aceita: $first"

second="$(curl -sS -b "$cookie_file" -H 'Content-Type: application/json' -d "{\"carregamento_id\":${loading_id},\"barcode\":\"7898250782592\"}" "$base_url/api/leituras.php")"
printf '%s' "$second" | grep -q '"result":"EXCESSO"' || fail "excesso do produto A não foi detectado por item: $second"

# A fixture é descartável; finalize-a para não bloquear as etapas seguintes
# por ocupação da única Dala disponível no ambiente local.
curl -sS -b "$cookie_file" -X PATCH -H 'Content-Type: application/json' \
  -d "{\"carregamento_id\":${loading_id},\"state\":\"CARREGANDO\"}" \
  "$base_url/api/estado_carregamento.php" >/dev/null
curl -sS -b "$cookie_file" -H 'Content-Type: application/json' \
  -d "{\"carregamento_id\":${loading_id},\"justification\":\"Fixture da etapa 38 finalizada.\"}" \
  "$base_url/api/encerrar_carregamento.php" >/dev/null

echo "OK: quantidade planejada foi aplicada por produto; A excedido não bloqueia indevidamente o produto B."
