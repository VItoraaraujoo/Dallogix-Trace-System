#!/usr/bin/env bash
set -u

mysql_query() {
  docker compose exec -T mysql sh -lc \
    'mysql -N -B --default-character-set=utf8mb4 -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -e "$1"' \
    trace-etapa2 "$1"
}

tables="$(mysql_query 'SHOW TABLES' 2>/dev/null)"
required=(empresas usuarios equipamentos produtos codigos_produtos romaneios romaneio_caminhoes romaneio_itens carregamentos eventos_sensor leituras ocorrencias retornos imagens status_dispositivos logs_auditoria fila_sincronizacao)

for table in "${required[@]}"; do
  if ! printf '%s\n' "$tables" | grep -Fxq "$table"; then
    echo "FAIL: tabela ausente: $table"
    exit 1
  fi
done

seed="$(mysql_query "SELECT COUNT(*) FROM empresas WHERE name='Empresa Demonstração'; SELECT COUNT(*) FROM usuarios WHERE email='admin@dallogix.local'; SELECT COUNT(*) FROM equipamentos WHERE equipment_code='EST-001'; SELECT COUNT(*) FROM produtos WHERE code='PROD3'; SELECT COUNT(*) FROM codigos_produtos WHERE barcode='7898250782592';" 2>/dev/null | tr '\n' ' ')"

if [[ "$seed" != "1 1 1 1 1 " ]]; then
  echo "FAIL: seed local incompleto: $seed"
  exit 1
fi

fk_count="$(mysql_query "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY';" 2>/dev/null)"
unique_count="$(mysql_query "SELECT COUNT(DISTINCT CONCAT(TABLE_NAME, ':', INDEX_NAME)) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME LIKE 'uq_%';" 2>/dev/null)"

if (( fk_count < 20 )); then
  echo "FAIL: quantidade de FKs abaixo do esperado: $fk_count"
  exit 1
fi

if (( unique_count < 8 )); then
  echo "FAIL: quantidade de índices únicos abaixo do esperado: $unique_count"
  exit 1
fi

echo "OK: ${#required[@]} tabelas, seed local, ${fk_count} FKs e ${unique_count} índices únicos validados."
