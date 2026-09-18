<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

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

$pdo->beginTransaction();
try {
    foreach ($events as $event) {
        $eventUuid = trim((string) ($event["event_uuid"] ?? ""));
        $eventCompanyId = filter_var($event["company_id"] ?? null, FILTER_VALIDATE_INT);
        if (!preg_match('/^[a-f0-9-]{16,80}$/i', $eventUuid) || $eventCompanyId === false || (int) $eventCompanyId !== $companyId) {
            throw new RuntimeException("Evento de sincronização inválido.");
        }
        $existing = $pdo->prepare(
            "SELECT id FROM logs_auditoria WHERE company_id = :company_id AND event_uuid = :event_uuid LIMIT 1",
        );
        $existing->execute(["company_id" => $companyId, "event_uuid" => $eventUuid]);
        if ($existing->fetchColumn()) {
            $ignored++;
            continue;
        }

        $action = trim((string) ($event["payload"]["action"] ?? ""));
        $data = is_array($event["payload"]["data"] ?? null) ? $event["payload"]["data"] : [];
        $entityType = trim((string) ($event["aggregate_type"] ?? $event["payload"]["entity_type"] ?? "sincronizacao"));
        $entityId = (int) ($event["aggregate_id"] ?? $event["payload"]["entity_id"] ?? 0);

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

        $audit = $pdo->prepare(
            "INSERT INTO logs_auditoria
             (event_uuid, company_id, user_id, action, entity_type, entity_id, metadata, delivered_at)
             VALUES (:event_uuid, :company_id, NULL, :action, :entity_type, :entity_id, :metadata, NOW(3))",
        );
        $audit->execute([
            "event_uuid" => $eventUuid,
            "company_id" => $companyId,
            "action" => $action !== "" ? $action : "SINCRONIZACAO_RECEBIDA",
            "entity_type" => $entityType,
            "entity_id" => max(1, $entityId),
            "metadata" => json_encode($event, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ]);
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
