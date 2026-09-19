<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";
require_once __DIR__ . "/../src/Aplicacao/InicializadorAcoesDala.php";

use App\Aplicacao\InicializadorAcoesDala;

if (trace_e_instalacao_local()) {
    responder_json(["error" => "Endpoint disponível somente no servidor central."], 403);
}
exigir_metodo_http(["POST"]);
$company = exigir_instalacao_remota();
$companyId = (int) $company["id"];
$payload = ler_json_da_requisicao();
$events = isset($payload["events"]) && is_array($payload["events"])
    ? $payload["events"]
    : [$payload];
$pdo = obter_conexao_banco();
$processed = 0;
$ignored = 0;

$upsertEquipment = static function (PDO $connection, int $companyId, int $remoteEquipmentId, array $data): int {
    $code = trim((string) ($data["equipment_code"] ?? ""));
    $name = trim((string) ($data["name"] ?? ""));
    $plcIp = trim((string) ($data["plc_ip"] ?? ""));
    $plcPort = filter_var($data["plc_port"] ?? 502, FILTER_VALIDATE_INT);
    $externalPort = ($data["external_port"] ?? null) === null || ($data["external_port"] ?? "") === ""
        ? null
        : filter_var($data["external_port"], FILTER_VALIDATE_INT);
    $protocol = strtoupper(trim((string) ($data["plc_protocol"] ?? "MODBUS_TCP")));
    $previousCode = trim((string) ($data["previous_equipment_code"] ?? ""));

    if (
        !preg_match('/^[a-z0-9_]{1,30}$/', $code) ||
        $name === "" ||
        $plcIp === "" ||
        $plcPort === false ||
        (int) $plcPort < 1 ||
        (int) $plcPort > 65535 ||
        ($externalPort !== null && ($externalPort === false || (int) $externalPort < 1 || (int) $externalPort > 65535)) ||
        !in_array($protocol, ["MODBUS_TCP", "MODBUS_RTU"], true)
    ) {
        throw new RuntimeException("Dados da Dala recebidos pela sincronização são inválidos.");
    }

    $identity = ["equipment_code = :equipment_code"];
    $params = [
        "company_id" => $companyId,
        "equipment_code" => $code,
    ];
    if ($previousCode !== "" && $previousCode !== $code) {
        $identity[] = "equipment_code = :previous_equipment_code";
        $params["previous_equipment_code"] = $previousCode;
    }
    if ($remoteEquipmentId > 0) {
        $identity[] = "remote_equipment_id = :remote_equipment_id";
        $params["remote_equipment_id"] = $remoteEquipmentId;
    }
    $find = $connection->prepare(
        "SELECT id FROM equipamentos WHERE company_id = :company_id AND (" . implode(" OR ", $identity) . ") LIMIT 1",
    );
    $find->execute($params);
    $equipmentId = (int) ($find->fetchColumn() ?: 0);
    $values = [
        "company_id" => $companyId,
        "remote_equipment_id" => $remoteEquipmentId > 0 ? $remoteEquipmentId : null,
        "equipment_code" => $code,
        "name" => $name,
        "plc_ip" => $plcIp,
        "plc_port" => (int) $plcPort,
        "external_port" => $externalPort === null ? null : (int) $externalPort,
        "plc_protocol" => $protocol,
    ];

    if ($equipmentId > 0) {
        $update = $connection->prepare(
            "UPDATE equipamentos SET remote_equipment_id = :remote_equipment_id,
             equipment_code = :equipment_code, name = :name, plc_ip = :plc_ip,
             plc_port = :plc_port, external_port = :external_port, plc_protocol = :plc_protocol
             WHERE id = :id AND company_id = :company_id",
        );
        $update->execute([...$values, "id" => $equipmentId]);
    } else {
        $insert = $connection->prepare(
            "INSERT INTO equipamentos
             (company_id, remote_equipment_id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol)
             VALUES (:company_id, :remote_equipment_id, :equipment_code, :name, :plc_ip, :plc_port, :external_port, :plc_protocol)",
        );
        $insert->execute($values);
        $equipmentId = (int) $connection->lastInsertId();
    }
    InicializadorAcoesDala::garantir($connection, $companyId, $equipmentId);
    return $equipmentId;
};

$deleteEquipment = static function (PDO $connection, int $companyId, int $remoteEquipmentId, array $data): int {
    $code = trim((string) ($data["equipment_code"] ?? ""));
    if ($remoteEquipmentId <= 0 && $code === "") {
        return 0;
    }
    $identity = [];
    $params = ["company_id" => $companyId];
    if ($remoteEquipmentId > 0) {
        $identity[] = "remote_equipment_id = :remote_equipment_id";
        $params["remote_equipment_id"] = $remoteEquipmentId;
    }
    if ($code !== "") {
        $identity[] = "equipment_code = :equipment_code";
        $params["equipment_code"] = $code;
    }
    $find = $connection->prepare(
        "SELECT id FROM equipamentos WHERE company_id = :company_id AND (" . implode(" OR ", $identity) . ") LIMIT 1",
    );
    $find->execute($params);
    $equipmentId = (int) ($find->fetchColumn() ?: 0);
    if ($equipmentId === 0) {
        return 0;
    }
    $activeLoadings = $connection->prepare(
        "UPDATE carregamentos
         SET equipment_id = NULL, state = 'AGUARDANDO', started_at = NULL
         WHERE company_id = :company_id AND equipment_id = :equipment_id
           AND state <> 'FINALIZADO'",
    );
    $activeLoadings->execute([
        "company_id" => $companyId,
        "equipment_id" => $equipmentId,
    ]);
        $connection->prepare(
            "UPDATE solicitacoes_comandos_clp
         SET equipment_id = NULL, status = CASE WHEN status IN ('PENDENTE', 'PROCESSANDO') THEN 'ERRO' ELSE status END,
             completed_at = COALESCE(completed_at, NOW(3)),
             response_message = COALESCE(response_message, 'Dala excluída antes da conclusão do comando.')
         WHERE company_id = :company_id AND equipment_id = :equipment_id",
    )->execute(["company_id" => $companyId, "equipment_id" => $equipmentId]);
    $connection->prepare(
        "UPDATE solicitacoes_captura_camera
         SET equipment_id = NULL, status = CASE WHEN status IN ('PENDENTE', 'CAPTURANDO') THEN 'DESCARTADA' ELSE status END,
             error_message = COALESCE(error_message, 'Dala excluída antes da captura.')
         WHERE equipment_id = :equipment_id",
    )->execute(["equipment_id" => $equipmentId]);
    $connection->prepare("UPDATE eventos_sensor SET equipment_id = NULL WHERE equipment_id = :equipment_id")
        ->execute(["equipment_id" => $equipmentId]);
    $connection->prepare("UPDATE imagens SET equipment_id = NULL WHERE equipment_id = :equipment_id")
        ->execute(["equipment_id" => $equipmentId]);
    $connection->prepare("DELETE FROM dispositivos WHERE company_id = :company_id AND equipment_id = :equipment_id")
        ->execute(["company_id" => $companyId, "equipment_id" => $equipmentId]);
    $connection->prepare("DELETE FROM gatilhos_dala WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
    $connection->prepare("DELETE FROM acoes_dala WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
    $connection->prepare("DELETE FROM status_dispositivos WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
    try {
        $connection->prepare("DELETE FROM equipamentos WHERE id = :id AND company_id = :company_id")->execute([
            "id" => $equipmentId,
            "company_id" => $companyId,
        ]);
    } catch (PDOException $exception) {
        if ((int) ($exception->errorInfo[1] ?? 0) !== 1451) {
            throw $exception;
        }
    }
    return $equipmentId;
};

$pdo->beginTransaction();
try {
    foreach ($events as $event) {
        $eventUuid = trim((string) ($event["event_uuid"] ?? ""));
        $eventCompanyId = filter_var($event["company_id"] ?? null, FILTER_VALIDATE_INT);
        if (!preg_match('/^[a-f0-9-]{16,80}$/i', $eventUuid) || $eventCompanyId === false || (int) $eventCompanyId !== $companyId) {
            throw new RuntimeException("Evento de sincronização inválido.");
        }
        $action = trim((string) ($event["payload"]["action"] ?? ""));
        $data = is_array($event["payload"]["data"] ?? null) ? $event["payload"]["data"] : [];
        $entityType = trim((string) ($event["aggregate_type"] ?? $event["payload"]["entity_type"] ?? "sincronizacao"));
        $entityId = (int) ($event["aggregate_id"] ?? $event["payload"]["entity_id"] ?? 0);
        $isEquipmentEvent = in_array($action, ["DALA_CADASTRADA", "DALA_ATUALIZADA", "DALA_EXCLUIDA"], true);
        $existing = $pdo->prepare(
            "SELECT id FROM logs_auditoria WHERE company_id = :company_id AND event_uuid = :event_uuid LIMIT 1",
        );
        $existing->execute(["company_id" => $companyId, "event_uuid" => $eventUuid]);
        $replay = (bool) $existing->fetchColumn();
        if ($replay && !$isEquipmentEvent) {
            $ignored++;
            continue;
        }

        if (in_array($action, ["DALA_CADASTRADA", "DALA_ATUALIZADA"], true)) {
            $entityId = $upsertEquipment($pdo, $companyId, $entityId, $data);
        }

        if ($action === "DALA_EXCLUIDA") {
            $entityId = $deleteEquipment(
                $pdo,
                $companyId,
                (int) ($data["remote_equipment_id"] ?? $entityId),
                $data,
            );
        }

        if (in_array($action, ["CARREGAMENTO_DALA_DESVINCULADO", "CARREGAMENTO_DALA_VINCULADO"], true)) {
            $remoteLoadingId = filter_var($data["remote_carregamento_id"] ?? null, FILTER_VALIDATE_INT);
            $loadingId = $remoteLoadingId !== false && $remoteLoadingId > 0
                ? (int) $remoteLoadingId
                : $entityId;
            if ($loadingId > 0) {
                if ($action === "CARREGAMENTO_DALA_DESVINCULADO") {
                    $update = $pdo->prepare(
                        "UPDATE carregamentos
                         SET equipment_id = NULL, state = 'AGUARDANDO', started_at = NULL
                         WHERE id = :id AND company_id = :company_id",
                    );
                    $update->execute(["id" => $loadingId, "company_id" => $companyId]);
                } else {
                    $remoteEquipmentId = filter_var($data["remote_equipment_id"] ?? null, FILTER_VALIDATE_INT);
                    $equipmentCode = trim((string) ($data["equipment_code"] ?? ""));
                    $equipment = $pdo->prepare(
                        "SELECT id FROM equipamentos
                         WHERE company_id = :company_id
                           AND ((:remote_id_a IS NOT NULL AND remote_equipment_id = :remote_id_b)
                             OR (:equipment_code_a <> '' AND equipment_code = :equipment_code_b))
                         LIMIT 1",
                    );
                    $equipment->execute([
                        "company_id" => $companyId,
                        "remote_id_a" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
                        "remote_id_b" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
                        "equipment_code_a" => $equipmentCode,
                        "equipment_code_b" => $equipmentCode,
                    ]);
                    $equipmentId = $equipment->fetchColumn();
                    if ($equipmentId) {
                        $update = $pdo->prepare(
                            "UPDATE carregamentos
                             SET equipment_id = :equipment_id, state = 'AGUARDANDO', started_at = NULL
                             WHERE id = :id AND company_id = :company_id",
                        );
                        $update->execute([
                            "equipment_id" => $equipmentId,
                            "id" => $loadingId,
                            "company_id" => $companyId,
                        ]);
                    }
                }
                $entityId = $loadingId;
            }
        }

        if ($action === "ESTADO_CARREGAMENTO_ALTERADO") {
            $remoteLoadingId = filter_var($data["remote_carregamento_id"] ?? null, FILTER_VALIDATE_INT);
            $state = strtoupper(trim((string) ($data["state"] ?? "")));
            if ($remoteLoadingId !== false && $remoteLoadingId > 0 && in_array($state, ["AGUARDANDO", "PREPARANDO", "CARREGANDO", "PAUSADO", "FINALIZANDO", "EMERGENCIA"], true)) {
                $update = $pdo->prepare("UPDATE carregamentos SET state = :state WHERE id = :id AND company_id = :company_id");
                $update->execute(["state" => $state, "id" => $remoteLoadingId, "company_id" => $companyId]);
                $entityId = (int) $remoteLoadingId;
            }
        }

        if (in_array($action, ["COMANDO_CLP_CONCLUIDO", "COMANDO_CLP_EXPIRADO"], true)) {
            $remoteCommandId = filter_var($data["remote_command_id"] ?? null, FILTER_VALIDATE_INT);
            if ($remoteCommandId !== false && $remoteCommandId > 0) {
                $status = $action === "COMANDO_CLP_EXPIRADO" ? "ERRO" : strtoupper((string) ($data["status"] ?? "ERRO"));
                if (!in_array($status, ["APLICADO", "REJEITADO", "ERRO"], true)) {
                    $status = "ERRO";
                }
                $update = $pdo->prepare(
                    "UPDATE solicitacoes_comandos_clp
                     SET status = :status, completed_at = NOW(3), response_message = :message
                     WHERE id = :id AND company_id = :company_id",
                );
                $update->execute([
                    "status" => $status,
                    "message" => $data["message"] ?? null,
                    "id" => $remoteCommandId,
                    "company_id" => $companyId,
                ]);
                $entityId = (int) $remoteCommandId;
            }
        }

        if ($action === "STATUS_DISPOSITIVO_ALTERADO") {
            $remoteEquipmentId = filter_var($data["remote_equipment_id"] ?? null, FILTER_VALIDATE_INT);
            $equipmentCode = trim((string) ($data["equipment_code"] ?? ""));
            $equipment = $pdo->prepare(
                "SELECT id FROM equipamentos WHERE company_id = :company_id
                 AND ((:remote_id_a IS NOT NULL AND remote_equipment_id = :remote_id_b)
                   OR (:equipment_code_a <> '' AND equipment_code = :equipment_code_b)) LIMIT 1",
            );
            $equipment->execute([
                "company_id" => $companyId,
                "remote_id_a" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
                "remote_id_b" => $remoteEquipmentId === false ? null : (int) $remoteEquipmentId,
                "equipment_code_a" => $equipmentCode,
                "equipment_code_b" => $equipmentCode,
            ]);
            $equipmentId = $equipment->fetchColumn();
            $status = strtoupper((string) ($data["status"] ?? "DESCONHECIDO"));
            $deviceType = strtoupper((string) ($data["device_type"] ?? "CLP"));
            if ($equipmentId && in_array($status, ["ONLINE", "OFFLINE", "ERRO", "DESCONHECIDO"], true)) {
                $statusRow = $pdo->prepare(
                    "INSERT INTO status_dispositivos (equipment_id, device_type, status, last_seen_at, details)
                     VALUES (:equipment_id, :device_type, :status, NOW(3), :details)
                     ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = VALUES(last_seen_at), details = VALUES(details)",
                );
                $statusRow->execute([
                    "equipment_id" => $equipmentId,
                    "device_type" => $deviceType,
                    "status" => $status,
                    "details" => json_encode(["source" => "instalacao_local"], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
                ]);
                $entityId = (int) $equipmentId;
            }
        }

        $auditData = [
            "event_uuid" => $eventUuid,
            "company_id" => $companyId,
            "action" => $action !== "" ? $action : "SINCRONIZACAO_RECEBIDA",
            "entity_type" => $entityType,
            "entity_id" => max(1, $entityId),
            "metadata" => json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ];
        if ($replay) {
            $audit = $pdo->prepare(
                "UPDATE logs_auditoria
                 SET action = :action, entity_type = :entity_type, entity_id = :entity_id,
                     metadata = :metadata, delivered_at = NOW(3)
                 WHERE company_id = :company_id AND event_uuid = :event_uuid",
            );
            $audit->execute($auditData);
        } else {
            $audit = $pdo->prepare(
                "INSERT INTO logs_auditoria
                 (event_uuid, company_id, user_id, action, entity_type, entity_id, metadata, delivered_at)
                 VALUES (:event_uuid, :company_id, NULL, :action, :entity_type, :entity_id, :metadata, NOW(3))",
            );
            $audit->execute($auditData);
        }
        $processed++;
    }
    $pdo->commit();
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    responder_json(["error" => $exception->getMessage()], 422);
}

responder_json(["data" => ["processed" => $processed, "ignored" => $ignored]]);
