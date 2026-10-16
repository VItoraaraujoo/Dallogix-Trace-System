<?php

declare(strict_types=1);

namespace App\Aplicacao;

use PDO;

require_once __DIR__ . "/EstadoFisicoClp.php";

/** Serviço compartilhado pelo endpoint HTTP e pelo stream SSE do monitoramento. */
final class ServicoMonitoramento
{
    public function __construct(private readonly PDO $connection)
    {
    }

    /** @return array<string,mixed> */
    public function obterInstantaneo(
        int $companyId,
        int $periodDays = 30,
        int $clpSignalLimit = 3,
        int $cameraSignalLimit = 15,
    ): array
    {
        $periodDays = max(1, min(3650, $periodDays));
        $clpSignalLimit = max(1, min(60, $clpSignalLimit));
        $cameraSignalLimit = max(1, min(300, $cameraSignalLimit));
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
        $devices = $query(
            "SELECT d.equipment_id, d.device_type, d.status, d.last_seen_at,
                    CASE WHEN d.last_seen_at IS NULL THEN NULL
                         ELSE TIMESTAMPDIFF(SECOND, d.last_seen_at, NOW(3))
                    END AS segundos_sem_sinal,
                    CASE WHEN d.last_seen_at IS NULL THEN NULL
                         ELSE TIMESTAMPDIFF(MICROSECOND, d.last_seen_at, NOW(3))
                    END AS micros_sem_sinal,
                    e.equipment_code
             FROM status_dispositivos d
             JOIN equipamentos e ON e.id = d.equipment_id
             WHERE e.company_id = :company_id
             ORDER BY e.equipment_code, d.device_type",
            ["company_id" => $companyId],
        );
        foreach ($devices as &$device) {
            $limit = $device["device_type"] === "CAMERA" ? $cameraSignalLimit : $clpSignalLimit;
            $ageMicros = $device["micros_sem_sinal"];
            $reportedStatus = (string) $device["status"];
            $device["status"] = $reportedStatus === "ERRO"
                ? "ERRO"
                : ($reportedStatus === "ONLINE" && $ageMicros !== null
                    && (int) $ageMicros <= $limit * 1_000_000
                    ? "ONLINE"
                    : "OFFLINE");
            unset($device["micros_sem_sinal"]);
        }
        unset($device);
        $maquinas = $query(
            "WITH carregamento_candidato AS (
                SELECT c.id, c.equipment_id, c.state, c.romaneio_id, c.truck_id, c.leituras_validas,
                       ROW_NUMBER() OVER (PARTITION BY c.equipment_id ORDER BY c.id DESC) AS numero
                FROM carregamentos c
                JOIN romaneios r2 ON r2.id = c.romaneio_id
                WHERE c.state <> 'FINALIZADO'
                  AND r2.status NOT IN ('FINALIZADO', 'CANCELADO')
            ), quantidades_romaneio AS (
                SELECT ri.romaneio_id, ri.truck_id, SUM(ri.planned_quantity) AS planned_quantity
                FROM romaneio_itens ri
                GROUP BY ri.romaneio_id, ri.truck_id
            )
            SELECT e.id, e.equipment_code, e.name,
                   CASE
                       WHEN d.status = 'ONLINE' AND d.last_seen_at >= DATE_SUB(NOW(3), INTERVAL {$clpSignalLimit} SECOND) THEN 'ONLINE'
                       WHEN d.status = 'ERRO' THEN 'ERRO'
                       ELSE 'OFFLINE'
                   END AS clp_status,
                   d.last_seen_at, d.details AS clp_details,
                   c.id AS carregamento_id, c.state AS carregamento_state,
                   r.id AS romaneio_id, r.number AS romaneio_number, rt.plate,
                   COALESCE(qe.planned_quantity, 0) + COALESCE(qg.planned_quantity, 0) AS planned_quantity,
                   COALESCE(c.leituras_validas, 0) AS valid_readings
            FROM equipamentos e
            LEFT JOIN status_dispositivos d
              ON d.equipment_id = e.id AND d.device_type = 'CLP'
            LEFT JOIN carregamento_candidato c
              ON c.equipment_id = e.id AND c.numero = 1
            LEFT JOIN romaneios r ON r.id = c.romaneio_id
            LEFT JOIN romaneio_caminhoes rt ON rt.id = c.truck_id
            LEFT JOIN quantidades_romaneio qe
              ON qe.romaneio_id = c.romaneio_id AND qe.truck_id = c.truck_id
            LEFT JOIN quantidades_romaneio qg
              ON qg.romaneio_id = c.romaneio_id AND qg.truck_id IS NULL
            WHERE e.company_id = :company_id
            ORDER BY e.equipment_code",
            ["company_id" => $companyId],
        );
        foreach ($maquinas as &$maquina) {
            $running = EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes($maquina["clp_details"] ?? null);
            $maquina["physical_running"] = $running;
            $state = (string) ($maquina["carregamento_state"] ?? "");
            if ($maquina["clp_status"] !== "ONLINE") {
                $maquina["operational_status"] = "SEM_COMUNICACAO";
            } elseif ($running === true) {
                $maquina["operational_status"] = "OPERANDO";
            } elseif ($running === false) {
                $maquina["operational_status"] = "PARADA_CONFIRMADA";
            } elseif ($state === "EMERGENCIA") {
                $maquina["operational_status"] = "EMERGENCIA_SEM_CONFIRMACAO";
            } elseif ($state === "PAUSADO") {
                $maquina["operational_status"] = "PARADA_SOLICITADA";
            } elseif (in_array($state, ["CARREGANDO", "FINALIZANDO"], true)) {
                $maquina["operational_status"] = "OPERACAO_SEM_RETORNO";
            } else {
                $maquina["operational_status"] = "OCIOSA";
            }
            unset($maquina["clp_details"]);
        }
        unset($maquina);
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
            "limite_sinal_camera_segundos" => $cameraSignalLimit,
        ];
    }

    /** @return list<array<string,mixed>> */
    public function carregamentosAtivos(int $companyId): array
    {
        $statement = $this->connection->prepare(
            "WITH carregamentos_ativos AS (
                SELECT c.id, c.company_id, c.romaneio_id, c.truck_id,
                       c.equipment_id, c.state, c.started_at, c.finished_at,
                       c.leituras_validas, c.stop_reason, c.operator_alert
                FROM carregamentos c
                JOIN romaneios r ON r.id = c.romaneio_id
                WHERE c.company_id = :company_id_ativos
                  AND c.state <> 'FINALIZADO'
                  AND r.status NOT IN ('FINALIZADO', 'CANCELADO')
            ), quantidades_romaneio AS (
                SELECT ca.id AS carregamento_id,
                       SUM(ri.planned_quantity) AS planned_quantity
                FROM carregamentos_ativos ca
                JOIN romaneio_itens ri
                  ON ri.romaneio_id = ca.romaneio_id
                 AND (ri.truck_id = ca.truck_id OR ri.truck_id IS NULL)
                GROUP BY ca.id
            ), eventos_detectados AS (
                SELECT se.carregamento_id, se.equipment_id, COUNT(*) AS detected_bags
                FROM eventos_sensor se
                JOIN carregamentos_ativos ca
                  ON ca.id = se.carregamento_id AND ca.equipment_id = se.equipment_id
                GROUP BY se.carregamento_id, se.equipment_id
            ), alertas_fim_produto AS (
                SELECT la.entity_id AS carregamento_id,
                       JSON_UNQUOTE(JSON_EXTRACT(la.metadata, '$.message')) AS end_product_alert,
                       ROW_NUMBER() OVER (PARTITION BY la.entity_id ORDER BY la.id DESC) AS rn
                FROM logs_auditoria la
                JOIN carregamentos_ativos ca ON ca.id = la.entity_id
                WHERE la.company_id = :company_id_alertas
                  AND la.action = 'ALERTA_FIM_PRODUTO'
                  AND la.entity_type = 'carregamento'
            )
            SELECT ca.id, ca.state, ca.equipment_id, ca.started_at, ca.finished_at,
                   r.number AS romaneio_number, rt.plate, e.equipment_code,
                   COALESCE(qr.planned_quantity, 0) AS planned_quantity,
                   COALESCE(ca.leituras_validas, 0) AS valid_readings,
                   COALESCE(ed.detected_bags, 0) AS detected_bags,
                   ca.stop_reason, ca.operator_alert,
                   afp.end_product_alert
            FROM carregamentos_ativos ca
            JOIN romaneios r ON r.id = ca.romaneio_id
            JOIN romaneio_caminhoes rt ON rt.id = ca.truck_id
            LEFT JOIN equipamentos e ON e.id = ca.equipment_id
            LEFT JOIN quantidades_romaneio qr ON qr.carregamento_id = ca.id
            LEFT JOIN eventos_detectados ed
              ON ed.carregamento_id = ca.id AND ed.equipment_id = ca.equipment_id
            LEFT JOIN alertas_fim_produto afp
              ON afp.carregamento_id = ca.id AND afp.rn = 1
            ORDER BY ca.id DESC",
        );
        $statement->execute([
            "company_id_ativos" => $companyId,
            "company_id_alertas" => $companyId,
        ]);
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
        $loadingPlaceholders = [];
        $readingPlaceholders = [];
        $params = ["company_id" => $companyId];
        foreach ($loadingIds as $index => $loadingId) {
            $name = "loading_id_{$index}";
            $loadingPlaceholders[] = ":{$name}";
            $params[$name] = $loadingId;
            $readingName = "reading_loading_id_{$index}";
            $readingPlaceholders[] = ":{$readingName}";
            $params[$readingName] = $loadingId;
        }
        $itemsStatement = $this->connection->prepare(
            "WITH leituras_validas AS (
                SELECT l.carregamento_id, l.product_id, COUNT(*) AS loaded_quantity
                FROM leituras l
                WHERE l.result = 'VALIDO'
                  AND l.carregamento_id IN (" . implode(", ", $readingPlaceholders) . ")
                GROUP BY l.carregamento_id, l.product_id
            )
            SELECT c.id AS loading_id, ri.product_id, p.name, p.code,
                   SUM(ri.planned_quantity) AS planned_quantity,
                   COALESCE(lv.loaded_quantity, 0) AS loaded_quantity
            FROM carregamentos c
            JOIN romaneio_itens ri
              ON ri.romaneio_id = c.romaneio_id
             AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)
            JOIN produtos p ON p.id = ri.product_id
            LEFT JOIN leituras_validas lv
              ON lv.carregamento_id = c.id AND lv.product_id = ri.product_id
            WHERE c.company_id = :company_id
              AND c.id IN (" . implode(", ", $loadingPlaceholders) . ")
            GROUP BY c.id, ri.product_id, p.name, p.code, lv.loaded_quantity
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
