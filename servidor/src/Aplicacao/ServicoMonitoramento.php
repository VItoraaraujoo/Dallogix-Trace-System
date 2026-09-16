<?php

declare(strict_types=1);

namespace App\Aplicacao;

use PDO;

/** Serviço compartilhado pelo endpoint HTTP e pelo stream SSE do monitoramento. */
final class ServicoMonitoramento
{
    public function __construct(private readonly PDO $connection)
    {
    }

    /** @return array<string,mixed> */
    public function snapshot(int $companyId, int $periodDays = 30, int $clpSignalLimit = 3): array
    {
        $periodDays = max(1, min(3650, $periodDays));
        $clpSignalLimit = max(1, min(60, $clpSignalLimit));
        $query = function (string $sql, array $params): array {
            $statement = $this->connection->prepare($sql);
            $statement->execute($params);
            return $statement->fetchAll();
        };
        $romaneios = $query("SELECT status, COUNT(*) AS total FROM romaneios WHERE company_id = :company_id AND created_at >= DATE_SUB(NOW(), INTERVAL {$periodDays} DAY) GROUP BY status", ["company_id" => $companyId]);
        $readings = $query("SELECT l.result, COUNT(*) AS total FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id WHERE c.company_id = :company_id AND l.read_at >= DATE_SUB(NOW(), INTERVAL {$periodDays} DAY) GROUP BY l.result", ["company_id" => $companyId]);
        $lastReading = $query("SELECT l.barcode, l.result, l.read_at FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id WHERE c.company_id = :company_id ORDER BY l.id DESC LIMIT 1", ["company_id" => $companyId]);
        $occurrences = $query("SELECT o.id, o.type, o.quantity, o.description, o.created_at FROM ocorrencias o WHERE o.company_id = :company_id ORDER BY o.id DESC LIMIT 10", ["company_id" => $companyId]);
        $audit = $query("SELECT action, entity_type, entity_id, created_at FROM logs_auditoria WHERE company_id = :company_id ORDER BY id DESC LIMIT 10", ["company_id" => $companyId]);
        $pendingSync = $query("SELECT COUNT(*) AS total FROM fila_sincronizacao q WHERE q.company_id = :company_id AND q.status IN ('PENDENTE', 'ERRO', 'PROCESSANDO')", ["company_id" => $companyId]);
        $devices = $query("SELECT d.equipment_id, d.device_type, CASE WHEN d.status = 'ONLINE' AND d.last_seen_at >= DATE_SUB(NOW(), INTERVAL {$clpSignalLimit} SECOND) THEN 'ONLINE' WHEN d.status = 'ERRO' THEN 'ERRO' ELSE 'OFFLINE' END AS status, d.last_seen_at, CASE WHEN d.last_seen_at IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, d.last_seen_at, NOW()) END AS segundos_sem_sinal, e.equipment_code FROM status_dispositivos d JOIN equipamentos e ON e.id = d.equipment_id WHERE e.company_id = :company_id ORDER BY e.equipment_code, d.device_type", ["company_id" => $companyId]);
        $maquinas = $query("SELECT e.id, e.equipment_code, e.name, CASE WHEN d.status = 'ONLINE' AND d.last_seen_at >= DATE_SUB(NOW(3), INTERVAL {$clpSignalLimit} SECOND) THEN 'ONLINE' WHEN d.status = 'ERRO' THEN 'ERRO' ELSE 'OFFLINE' END AS clp_status, d.last_seen_at, c.id AS carregamento_id, c.state AS carregamento_state, r.id AS romaneio_id, r.number AS romaneio_number, rt.plate, COALESCE((SELECT SUM(ri.planned_quantity) FROM romaneio_itens ri WHERE ri.romaneio_id = c.romaneio_id AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)), 0) AS planned_quantity, COALESCE(c.leituras_validas, 0) AS valid_readings FROM equipamentos e LEFT JOIN status_dispositivos d ON d.equipment_id = e.id AND d.device_type = 'CLP' LEFT JOIN carregamentos c ON c.id = (SELECT c2.id FROM carregamentos c2 WHERE c2.equipment_id = e.id ORDER BY c2.id DESC LIMIT 1) LEFT JOIN romaneios r ON r.id = c.romaneio_id LEFT JOIN romaneio_caminhoes rt ON rt.id = c.truck_id WHERE e.company_id = :company_id ORDER BY e.equipment_code", ["company_id" => $companyId]);
        $romaneioSummary = [];
        foreach ($romaneios as $row) {
            $romaneioSummary[(string) $row["status"]] = (int) $row["total"];
        }
        $readingSummary = [];
        foreach ($readings as $row) {
            $readingSummary[(string) $row["result"]] = (int) $row["total"];
        }
        return [
            "romaneios" => $romaneioSummary,
            "leituras" => $readingSummary,
            "ultima_leitura" => $lastReading[0] ?? null,
            "ocorrencias" => $occurrences,
            "auditoria" => $audit,
            "sync_pendente" => (int) ($pendingSync[0]["total"] ?? 0),
            "dispositivos" => $devices,
            "maquinas" => $maquinas,
            "periodo_dias" => $periodDays,
            "limite_sinal_clp_segundos" => $clpSignalLimit,
        ];
    }

    /** @return list<array<string,mixed>> */
    public function activeLoadings(int $companyId): array
    {
        $statement = $this->connection->prepare("SELECT c.id, c.state, c.equipment_id, c.started_at, c.finished_at, r.number AS romaneio_number, rt.plate, e.equipment_code, COALESCE((SELECT SUM(ri.planned_quantity) FROM romaneio_itens ri WHERE ri.romaneio_id = c.romaneio_id AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)), 0) AS planned_quantity, COALESCE(c.leituras_validas, 0) AS valid_readings FROM carregamentos c JOIN romaneios r ON r.id = c.romaneio_id JOIN romaneio_caminhoes rt ON rt.id = c.truck_id JOIN equipamentos e ON e.id = c.equipment_id WHERE c.company_id = :company_id AND c.state <> 'FINALIZADO' ORDER BY c.id DESC");
        $statement->execute(["company_id" => $companyId]);
        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            $row["items"] = [];
        }
        unset($row);
        if (!$rows) {
            return $rows;
        }

        $loadingIds = array_values(array_unique(array_map(
            static fn (array $row): int => (int) $row["id"],
            $rows,
        )));
        $placeholders = [];
        $params = ["company_id" => $companyId];
        foreach ($loadingIds as $index => $loadingId) {
            $name = "loading_id_{$index}";
            $placeholders[] = ":{$name}";
            $params[$name] = $loadingId;
        }
        $itemsStatement = $this->connection->prepare(
            "SELECT c.id AS loading_id, ri.product_id, p.name, p.code,
                    SUM(ri.planned_quantity) AS planned_quantity,
                    (SELECT COUNT(*)
                     FROM leituras l
                     WHERE l.carregamento_id = c.id
                       AND l.product_id = ri.product_id
                       AND l.result = 'VALIDO') AS loaded_quantity
             FROM carregamentos c
             JOIN romaneio_itens ri
               ON ri.romaneio_id = c.romaneio_id
              AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)
             JOIN produtos p ON p.id = ri.product_id
             WHERE c.company_id = :company_id
               AND c.id IN (" . implode(", ", $placeholders) . ")
             GROUP BY c.id, ri.product_id, p.name, p.code
             ORDER BY c.id DESC, ri.product_id",
        );
        $itemsStatement->execute($params);
        $itemsByLoading = [];
        foreach ($itemsStatement->fetchAll() as $item) {
            $planned = (int) $item["planned_quantity"];
            $loaded = (int) $item["loaded_quantity"];
            $itemsByLoading[(int) $item["loading_id"]][] = [
                "product_id" => (int) $item["product_id"],
                "name" => $item["name"],
                "code" => $item["code"],
                "planned_quantity" => $planned,
                "loaded_quantity" => $loaded,
                "remaining_quantity" => max(0, $planned - $loaded),
            ];
        }
        foreach ($rows as &$row) {
            $row["items"] = $itemsByLoading[(int) $row["id"]] ?? [];
        }
        unset($row);
        return $rows;
    }
}
