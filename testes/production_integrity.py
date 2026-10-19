#!/usr/bin/env python3
"""Testa integridade relacional no MySQL descartável de homologação."""
import secrets
import subprocess
import sys

sys.path.insert(0, "scripts")
from production_test import COMPOSE, sql


def executar_uma_vez(statement: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        COMPOSE + [
            "exec", "-T", "mysql", "sh", "-c",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --batch --skip-column-names -u root "$MYSQL_DATABASE"',
        ],
        input=statement + "\n",
        text=True,
        capture_output=True,
    )


equipment_row = sql(
    "SELECT e.id, e.company_id FROM equipamentos e "
    "WHERE e.equipment_code = 'EST-001' "
    "AND NOT EXISTS (SELECT 1 FROM instalacoes_industriais i WHERE i.equipment_id = e.id) "
    "LIMIT 1"
)
if not equipment_row:
    raise SystemExit("Fixture descartável sem Dala livre para testar integridade.")
equipment_id, company_id = (int(value) for value in equipment_row.split("\t"))
created_by = int(sql("SELECT id FROM usuarios WHERE email = 'admin@dallogix.local' LIMIT 1"))
suffix = secrets.token_hex(8)
number = "INTEGRITY-" + suffix
romaneio_id = 0
installation_id = 0

try:
    sql(
        "INSERT INTO romaneios (company_id, number, scheduled_date, status) "
        f"VALUES ({company_id}, '{number}', CURRENT_DATE, 'IMPORTADO')"
    )
    romaneio_id = int(sql(f"SELECT id FROM romaneios WHERE number = '{number}'"))

    invalid_pair = executar_uma_vez(
        f"UPDATE romaneios SET assigned_installation_id = 999999999 "
        f"WHERE id = {romaneio_id}"
    )
    if invalid_pair.returncode == 0 or "deve informar o PC e a empresa juntos" not in invalid_pair.stderr:
        raise RuntimeError("O banco não recusou a atribuição incompleta do PC industrial.")

    sql(
        "INSERT INTO instalacoes_industriais (company_id, equipment_id, name, created_by) "
        f"VALUES ({company_id}, {equipment_id}, 'Teste de integridade {suffix}', {created_by})"
    )
    installation_id = int(
        sql(f"SELECT id FROM instalacoes_industriais WHERE equipment_id = {equipment_id}")
    )
    sql(
        "UPDATE romaneios SET assigned_installation_id = "
        f"{installation_id}, assigned_installation_company_id = {company_id} "
        f"WHERE id = {romaneio_id}"
    )
    sql(f"DELETE FROM instalacoes_industriais WHERE id = {installation_id}")
    installation_id = 0

    assignment = sql(
        "SELECT CONCAT(IF(assigned_installation_id IS NULL, 'NULL', 'SET'), '|', "
        "IF(assigned_installation_company_id IS NULL, 'NULL', 'SET')) "
        f"FROM romaneios WHERE id = {romaneio_id}"
    )
    if assignment != "NULL|NULL":
        raise RuntimeError("A exclusão do PC não limpou os dois campos de atribuição.")
finally:
    if installation_id:
        sql(f"DELETE FROM instalacoes_industriais WHERE id = {installation_id}")
    if romaneio_id:
        sql(f"DELETE FROM romaneios WHERE id = {romaneio_id}")

print("OK: atribuição incompleta recusada; exclusão do PC limpou os dois campos relacionados.")
