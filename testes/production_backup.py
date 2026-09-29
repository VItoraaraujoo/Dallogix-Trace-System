#!/usr/bin/env python3
"""Verifica backup e restauração em banco descartável no Compose de homologação."""
import hashlib
from pathlib import Path
import secrets
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from production_test import COMPOSE, ENV, ROOT, STATE, env_value, run, sql

folder = STATE / 'backups'
folder.mkdir(mode=0o700, exist_ok=True)
backup = folder / 'homologacao.sql'
with backup.open('wb') as output:
    run(COMPOSE + ['exec', '-T', 'mysql', 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --single-transaction --routines --events --triggers --no-tablespaces -u root "$MYSQL_DATABASE"'], stdout=output)
backup.chmod(0o600)
backup.with_suffix('.sql.sha256').write_text(hashlib.sha256(backup.read_bytes()).hexdigest() + '  homologacao.sql\n')
run(['bash', str(ROOT / 'scripts/verify_backup.sh'), str(backup)])
restore_db = 'trace_restore_' + secrets.token_hex(8)
database = env_value('MYSQL_DATABASE')
if not database or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' for char in database):
    raise SystemExit('Nome de banco inválido na configuração isolada de homologação.')
tables = sql('SHOW TABLES').splitlines()
def semantic_table_hashes(database_name, table_name):
    table_identifier = table_name.replace('`', '``')
    columns = sql(f'SHOW COLUMNS FROM `{database_name}`.`{table_identifier}`').splitlines()
    column_names = [line.split('\t', 1)[0] for line in columns if line]
    if not column_names:
        raise SystemExit(f'Não foi possível obter colunas da tabela {table_name}.')
    row_parts = []
    for column_name in column_names:
        identifier = '`' + column_name.replace('`', '``') + '`'
        binary_value = f'CAST({identifier} AS BINARY)'
        row_parts.append(
            f"IF({identifier} IS NULL, 'N;', "
            f"CONCAT('V', OCTET_LENGTH({binary_value}), ':', HEX({binary_value}), ';'))"
        )
    expression = ', '.join(row_parts)
    hashes = sql(
        f'SELECT SHA2(CONCAT({expression}), 256) '
        f'FROM `{database_name}`.`{table_identifier}` ORDER BY 1'
    )
    return hashes.splitlines() if hashes else []

semantic_hashes = {table: semantic_table_hashes(database, table) for table in tables}
sql(f'CREATE DATABASE `{restore_db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
try:
    sql(f'USE `{restore_db}`;\n' + backup.read_text())
    restored_hashes = {table: semantic_table_hashes(restore_db, table) for table in tables}
    differences = [table for table in tables if semantic_hashes[table] != restored_hashes[table]]
    if differences:
        raise SystemExit('Conteúdo restaurado diverge nas tabelas: ' + ', '.join(differences))
    print(f'OK: conteúdo do backup restaurado e comparado linha a linha em {len(tables)} tabelas.')
finally:
    sql(f'DROP DATABASE `{restore_db}`')
