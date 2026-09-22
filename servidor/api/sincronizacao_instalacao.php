<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

if (trace_e_instalacao_local()) {
    responder_json(["error" => "Endpoint disponível somente no servidor central."], 403);
}

exigir_metodo_http(["GET", "POST"]);
$company = exigir_instalacao_remota();
$pdo = obter_conexao_banco();
$companyId = (int) $company["id"];

if ($_SERVER["REQUEST_METHOD"] === "POST") {
    $payload = ler_json_da_requisicao();
    if (($payload["action"] ?? "") !== "heartbeat") {
        responder_json(["error" => "Ação de sincronização inválida."], 422);
    }
    $industrialPcReceived = false;
    $industrialPc = $payload["industrial_pc"] ?? null;
    if (is_array($industrialPc)) {
        $pcStatus = strtoupper(trim((string) ($industrialPc["status"] ?? "")));
        if (in_array($pcStatus, ["ONLINE", "OFFLINE", "ERRO", "DESCONHECIDO"], true)) {
            $reportedAt = trim((string) ($industrialPc["reported_at"] ?? ""));
            $pcDetails = ["source" => "instalacao_local"];
            if ($reportedAt !== "") {
                $pcDetails["reported_at"] = mb_substr($reportedAt, 0, 64);
            }
            $disk = $industrialPc["disk"] ?? null;
            if (is_array($disk)) {
                $freeBytes = filter_var($disk["free_bytes"] ?? null, FILTER_VALIDATE_INT, ["options" => ["min_range" => 0]]);
                $totalBytes = filter_var($disk["total_bytes"] ?? null, FILTER_VALIDATE_INT, ["options" => ["min_range" => 1]]);
                $freePercent = is_numeric($disk["free_percent"] ?? null) ? (float) $disk["free_percent"] : null;
                if ($freeBytes !== false && $totalBytes !== false && $freePercent !== null && $freePercent >= 0 && $freePercent <= 100) {
                    $pcDetails["disk"] = [
                        "free_bytes" => (int) $freeBytes,
                        "total_bytes" => (int) $totalBytes,
                        "free_percent" => round($freePercent, 2),
                    ];
                }
            }
            $pcUpsert = $pdo->prepare(
                "INSERT INTO status_pc_industrial (company_id, status, last_seen_at, details)
                 VALUES (:company_id, :status, NOW(3), :details)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = VALUES(last_seen_at), details = VALUES(details)",
            );
            $pcUpsert->execute([
                "company_id" => $companyId,
                "status" => $pcStatus,
                "details" => json_encode($pcDetails, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            ]);
            $industrialPcReceived = true;
        }
    }
    $upsert = $pdo->prepare(
        "INSERT INTO status_dispositivos
         (equipment_id, device_type, status, last_seen_at, details)
         SELECT e.id, :device_type, :status, COALESCE(:last_seen_at, NOW(3)), :details
         FROM equipamentos e
         WHERE e.company_id = :company_id
           AND ((:remote_equipment_id_a IS NOT NULL AND e.id = :remote_equipment_id_b)
             OR (:equipment_code_a <> '' AND e.equipment_code = :equipment_code_b))
         LIMIT 1
         ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = VALUES(last_seen_at), details = VALUES(details)",
    );
    $received = 0;
    foreach (($payload["heartbeats"] ?? []) as $heartbeat) {
        $deviceType = strtoupper(trim((string) ($heartbeat["device_type"] ?? "")));
        $status = strtoupper(trim((string) ($heartbeat["status"] ?? "")));
        if (!in_array($deviceType, ["CLP", "SCANNER", "SENSOR", "CAMERA", "SERVER"], true)) {
            continue;
        }
        if (!in_array($status, ["ONLINE", "OFFLINE", "ERRO", "DESCONHECIDO"], true)) {
            continue;
        }
        $remoteEquipmentId = filter_var($heartbeat["remote_equipment_id"] ?? null, FILTER_VALIDATE_INT);
        $equipmentCode = trim((string) ($heartbeat["equipment_code"] ?? ""));
        $details = json_encode(["source" => "instalacao_local"], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $upsert->execute([
            "device_type" => $deviceType,
            "status" => $status,
            "last_seen_at" => $heartbeat["last_seen_at"] ?? null,
            "details" => $details,
            "company_id" => $companyId,
            "remote_equipment_id_a" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
            "remote_equipment_id_b" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
            "equipment_code_a" => $equipmentCode,
            "equipment_code_b" => $equipmentCode,
        ]);
        // MySQL pode retornar rowCount() = 0 quando o heartbeat repete
        // exatamente os mesmos valores. A requisição ainda foi aceita e deve
        // ser contabilizada como recebida.
        $received++;
    }
    responder_json(["data" => ["received" => $received, "industrial_pc_received" => $industrialPcReceived]]);
}

$equipmentStatement = $pdo->prepare(
    "SELECT id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol
     FROM equipamentos WHERE company_id = :company_id ORDER BY id",
);
$equipmentStatement->execute(["company_id" => $companyId]);
$equipamentos = $equipmentStatement->fetchAll();

$loadingStatement = $pdo->prepare(
    "SELECT c.id, c.remote_carregamento_id, c.equipment_id, c.romaneio_id, c.truck_id,
            c.state, c.started_at, r.status AS romaneio_status, r.number AS romaneio_number, r.expedidor,
            r.scheduled_date, t.plate, t.driver_name, e.equipment_code,
            e.name AS equipment_name
     FROM carregamentos c
     JOIN romaneios r ON r.id = c.romaneio_id
     JOIN romaneio_caminhoes t ON t.id = c.truck_id
     LEFT JOIN equipamentos e ON e.id = c.equipment_id
     WHERE c.company_id = :company_id AND c.state <> 'FINALIZADO'
       AND r.status NOT IN ('FINALIZADO', 'CANCELADO')
     ORDER BY c.id",
);
$loadingStatement->execute(["company_id" => $companyId]);
$carregamentos = $loadingStatement->fetchAll();
$loadingIds = array_map(static fn (array $row): int => (int) $row["id"], $carregamentos);
foreach ($carregamentos as &$loading) {
    $loading["id"] = (int) $loading["id"];
    $loading["equipment_id"] = $loading["equipment_id"] === null ? null : (int) $loading["equipment_id"];
    $loading["romaneio_id"] = (int) $loading["romaneio_id"];
    $loading["truck_id"] = (int) $loading["truck_id"];
    $loading["items"] = [];
}
unset($loading);

if ($loadingIds !== []) {
    $placeholders = implode(",", array_fill(0, count($loadingIds), "?"));
    $items = $pdo->prepare(
        "SELECT c.id AS loading_id, p.code, p.name, SUM(ri.planned_quantity) AS planned_quantity
         FROM carregamentos c
         JOIN romaneio_itens ri ON ri.romaneio_id = c.romaneio_id
           AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)
         JOIN produtos p ON p.id = ri.product_id
         WHERE c.id IN ({$placeholders})
         GROUP BY c.id, p.code, p.name
         ORDER BY c.id, p.code",
    );
    $items->execute($loadingIds);
    $itemsByLoading = [];
    foreach ($items->fetchAll() as $item) {
        $itemsByLoading[(int) $item["loading_id"]][] = [
            "code" => $item["code"],
            "name" => $item["name"],
            "planned_quantity" => (int) $item["planned_quantity"],
        ];
    }
    foreach ($carregamentos as &$loading) {
        $loading["items"] = $itemsByLoading[(int) $loading["id"]] ?? [];
    }
    unset($loading);
}

$commandStatement = $pdo->prepare(
    "SELECT r.id, r.remote_command_id, r.equipment_id, r.carregamento_id, r.command,
            r.status, r.requested_at, r.claimed_at, r.completed_at, r.response_message,
            c.remote_carregamento_id, e.equipment_code
     FROM solicitacoes_comandos_clp r
     JOIN carregamentos c ON c.id = r.carregamento_id
     JOIN equipamentos e ON e.id = r.equipment_id
     WHERE r.company_id = :company_id AND r.status IN ('PENDENTE','PROCESSANDO')
     ORDER BY r.id",
);
$commandStatement->execute(["company_id" => $companyId]);

responder_json([
    "data" => [
        "empresa" => [
            "id" => $companyId,
            "name" => $company["name"],
            "login_domain" => $company["login_domain"],
            "license_status" => $company["license_status"],
            "license_reason" => $company["license_reason"],
        ],
        "equipamentos" => $equipamentos,
        "carregamentos_ativos" => $carregamentos,
        "comandos" => $commandStatement->fetchAll(),
        "sent_at" => date("c"),
    ],
]);
