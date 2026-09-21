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
$mappings = [];

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

$upsertProduct = static function (PDO $connection, int $companyId, array $data): int {
    $code = trim((string) ($data["code"] ?? ""));
    $name = trim((string) ($data["name"] ?? $code));
    $category = trim((string) ($data["category"] ?? ""));
    if ($code === "" || $name === "" || !preg_match('/^[A-Za-z0-9À-ÿ _.,\/-]{1,80}$/u', $code)) {
        throw new RuntimeException("Produto recebido pela sincronização é inválido.");
    }
    $find = $connection->prepare(
        "SELECT id FROM produtos WHERE company_id = :company_id AND code = :code LIMIT 1",
    );
    $find->execute(["company_id" => $companyId, "code" => $code]);
    $productId = (int) ($find->fetchColumn() ?: 0);
    if ($productId > 0) {
        $update = $connection->prepare(
            "UPDATE produtos SET name = :name, category = :category,
             active = :active WHERE id = :id AND company_id = :company_id",
        );
        $update->execute([
            "name" => $name,
            "category" => $category !== "" ? $category : null,
            "active" => array_key_exists("active", $data) ? (int) (bool) $data["active"] : 1,
            "id" => $productId,
            "company_id" => $companyId,
        ]);
    } else {
        $insert = $connection->prepare(
            "INSERT INTO produtos (company_id, code, name, category, active)
             VALUES (:company_id, :code, :name, :category, :active)",
        );
        $insert->execute([
            "company_id" => $companyId,
            "code" => $code,
            "name" => $name,
            "category" => $category !== "" ? $category : null,
            "active" => array_key_exists("active", $data) ? (int) (bool) $data["active"] : 1,
        ]);
        $productId = (int) $connection->lastInsertId();
    }

    $barcode = trim((string) ($data["barcode"] ?? ""));
    if ($barcode !== "") {
        $barcodeOwner = $connection->prepare(
            "SELECT product_id FROM codigos_produtos
             WHERE company_id = :company_id AND barcode = :barcode LIMIT 1",
        );
        $barcodeOwner->execute(["company_id" => $companyId, "barcode" => $barcode]);
        $owner = (int) ($barcodeOwner->fetchColumn() ?: 0);
        if ($owner === 0) {
            $connection->prepare(
                "INSERT INTO codigos_produtos (company_id, product_id, barcode)
                 VALUES (:company_id, :product_id, :barcode)",
            )->execute(["company_id" => $companyId, "product_id" => $productId, "barcode" => $barcode]);
        }
    }
    return $productId;
};

$upsertManifest = static function (PDO $connection, int $companyId, int $sourceManifestId, array $data): array {
    $knownRemoteId = filter_var($data["remote_romaneio_id"] ?? null, FILTER_VALIDATE_INT);
    $knownRemoteId = $knownRemoteId !== false && $knownRemoteId !== null && $knownRemoteId > 0
        ? (int) $knownRemoteId : null;
    $sourceId = filter_var($data["source_romaneio_id"] ?? $sourceManifestId, FILTER_VALIDATE_INT);
    $sourceId = $sourceId !== false && $sourceId !== null && $sourceId > 0 ? (int) $sourceId : 0;
    if ($sourceId < 1) {
        throw new RuntimeException("Identificador do romaneio recebido pela sincronização é inválido.");
    }
    $number = trim((string) ($data["number"] ?? ""));
    $scheduledDate = trim((string) ($data["scheduled_date"] ?? date("Y-m-d")));
    $status = strtoupper(trim((string) ($data["status"] ?? "AGUARDANDO")));
    $allowedStatuses = ["IMPORTADO", "AGUARDANDO", "EM_ANDAMENTO", "FINALIZADO", "CANCELADO"];
    if ($number === "" || !in_array($status, $allowedStatuses, true)) {
        throw new RuntimeException("Romaneio recebido pela sincronização é inválido.");
    }
    $date = DateTime::createFromFormat("Y-m-d", $scheduledDate);
    if (!$date || $date->format("Y-m-d") !== $scheduledDate) {
        throw new RuntimeException("Data do romaneio recebido pela sincronização é inválida.");
    }
    $find = $knownRemoteId === null
        ? $connection->prepare(
            "SELECT id FROM romaneios WHERE company_id = :company_id
             AND (remote_romaneio_id = :source_id OR number = :number) LIMIT 1",
        )
        : $connection->prepare(
            "SELECT id FROM romaneios WHERE company_id = :company_id
             AND (id = :remote_id OR remote_romaneio_id = :source_id OR number = :number) LIMIT 1",
        );
    $find->execute([
        "company_id" => $companyId,
        "source_id" => $sourceId,
        "number" => $number,
        ...($knownRemoteId === null ? [] : ["remote_id" => $knownRemoteId]),
    ]);
    $manifestId = (int) ($find->fetchColumn() ?: 0);
    $values = [
        "remote_id" => $sourceId,
        "number" => $number,
        "scheduled_date" => $scheduledDate,
        "status" => $status,
        "expedidor" => trim((string) ($data["expedidor"] ?? "")) ?: null,
        "company_id" => $companyId,
    ];
    if ($manifestId > 0) {
        $connection->prepare(
            "UPDATE romaneios SET remote_romaneio_id = :remote_id, number = :number,
             scheduled_date = :scheduled_date, status = :status, expedidor = :expedidor
             WHERE id = :id AND company_id = :company_id",
        )->execute([...$values, "id" => $manifestId]);
    } else {
        $connection->prepare(
            "INSERT INTO romaneios
             (company_id, remote_romaneio_id, number, scheduled_date, status, expedidor)
             VALUES (:company_id, :remote_id, :number, :scheduled_date, :status, :expedidor)",
        )->execute($values);
        $manifestId = (int) $connection->lastInsertId();
    }
    return ["id" => $manifestId, "remote_id" => $sourceId];
};

$upsertTruck = static function (PDO $connection, int $manifestId, array $data): array {
    $knownRemoteId = filter_var($data["remote_truck_id"] ?? null, FILTER_VALIDATE_INT);
    $knownRemoteId = $knownRemoteId !== false && $knownRemoteId !== null && $knownRemoteId > 0
        ? (int) $knownRemoteId : null;
    $sourceId = filter_var($data["source_truck_id"] ?? null, FILTER_VALIDATE_INT);
    $sourceId = $sourceId !== false && $sourceId !== null && $sourceId > 0 ? (int) $sourceId : null;
    $plate = strtoupper(trim((string) ($data["plate"] ?? "")));
    if ($plate === "") {
        throw new RuntimeException("Caminhão recebido pela sincronização é inválido.");
    }
    $find = $knownRemoteId === null
        ? $connection->prepare(
            "SELECT id FROM romaneio_caminhoes WHERE romaneio_id = :romaneio_id
             AND ((:source_id_a IS NOT NULL AND remote_truck_id = :source_id_b)
               OR plate = :plate) LIMIT 1",
        )
        : $connection->prepare(
            "SELECT id FROM romaneio_caminhoes WHERE romaneio_id = :romaneio_id
             AND ((id = :remote_id) OR (:source_id_a IS NOT NULL AND remote_truck_id = :source_id_b)
               OR plate = :plate) LIMIT 1",
        );
    $findParams = [
        "romaneio_id" => $manifestId,
        "source_id_a" => $sourceId,
        "source_id_b" => $sourceId,
        "plate" => $plate,
    ];
    if ($knownRemoteId !== null) {
        $findParams["remote_id"] = $knownRemoteId;
    }
    $find->execute($findParams);
    $truckId = (int) ($find->fetchColumn() ?: 0);
    $values = [
        "remote_id" => $sourceId,
        "plate" => $plate,
        "driver_name" => trim((string) ($data["driver_name"] ?? "")) ?: null,
    ];
    if ($truckId > 0) {
        $connection->prepare(
            "UPDATE romaneio_caminhoes SET remote_truck_id = :remote_id,
             plate = :plate, driver_name = :driver_name
             WHERE id = :id AND romaneio_id = :romaneio_id",
        )->execute([...$values, "id" => $truckId, "romaneio_id" => $manifestId]);
    } else {
        $connection->prepare(
            "INSERT INTO romaneio_caminhoes
             (romaneio_id, remote_truck_id, plate, driver_name)
             VALUES (:romaneio_id, :remote_id, :plate, :driver_name)",
        )->execute([...$values, "romaneio_id" => $manifestId]);
        $truckId = (int) $connection->lastInsertId();
    }
    return ["id" => $truckId, "remote_id" => $sourceId];
};

$replaceManifestItems = static function (PDO $connection, int $companyId, int $manifestId, int $truckId, array $items, callable $productWriter): void {
    $connection->prepare("DELETE FROM romaneio_itens WHERE romaneio_id = :romaneio_id")
        ->execute(["romaneio_id" => $manifestId]);
    $insert = $connection->prepare(
        "INSERT INTO romaneio_itens (romaneio_id, product_id, truck_id, planned_quantity)
         VALUES (:romaneio_id, :product_id, :truck_id, :quantity)",
    );
    foreach ($items as $item) {
        if (!is_array($item)) {
            throw new RuntimeException("Item de romaneio recebido pela sincronização é inválido.");
        }
        $quantity = filter_var($item["planned_quantity"] ?? ($item["quantity"] ?? null), FILTER_VALIDATE_INT);
        if ($quantity === false || $quantity < 1) {
            throw new RuntimeException("Quantidade de item recebida pela sincronização é inválida.");
        }
        $productId = $productWriter($connection, $companyId, $item);
        $insert->execute([
            "romaneio_id" => $manifestId,
            "product_id" => $productId,
            "truck_id" => $truckId > 0 ? $truckId : null,
            "quantity" => (int) $quantity,
        ]);
    }
};

$findEquipment = static function (PDO $connection, int $companyId, array $data): ?int {
    $remoteId = filter_var($data["remote_equipment_id"] ?? null, FILTER_VALIDATE_INT);
    $code = trim((string) ($data["equipment_code"] ?? ""));
    if (($remoteId === false || $remoteId === null || $remoteId < 1) && $code === "") {
        return null;
    }
    $statement = $connection->prepare(
        "SELECT id FROM equipamentos WHERE company_id = :company_id
         AND ((:remote_id_a IS NOT NULL AND remote_equipment_id = :remote_id_b)
           OR (:code_a <> '' AND equipment_code = :code_b)) LIMIT 1",
    );
    $statement->execute([
        "company_id" => $companyId,
        "remote_id_a" => $remoteId !== false && $remoteId !== null && $remoteId > 0 ? (int) $remoteId : null,
        "remote_id_b" => $remoteId !== false && $remoteId !== null && $remoteId > 0 ? (int) $remoteId : null,
        "code_a" => $code,
        "code_b" => $code,
    ]);
    $id = $statement->fetchColumn();
    return $id === false ? null : (int) $id;
};

$syncManifestStatus = static function (PDO $connection, int $companyId, int $loadingId, string $state, ?bool $manifestFinalized = null): void {
    $loading = $connection->prepare(
        "SELECT romaneio_id FROM carregamentos
         WHERE id = :id AND company_id = :company_id LIMIT 1",
    );
    $loading->execute(["id" => $loadingId, "company_id" => $companyId]);
    $manifestId = (int) ($loading->fetchColumn() ?: 0);
    if ($manifestId < 1) {
        return;
    }

    $active = $connection->prepare(
        "SELECT COUNT(*) FROM carregamentos
         WHERE company_id = :company_id AND romaneio_id = :romaneio_id
           AND id <> :loading_id AND state <> 'FINALIZADO'",
    );
    $active->execute([
        "company_id" => $companyId,
        "romaneio_id" => $manifestId,
        "loading_id" => $loadingId,
    ]);
    $hasOtherActiveLoading = (int) $active->fetchColumn() > 0;

    $status = match ($state) {
        "FINALIZADO" => ($manifestFinalized === true || !$hasOtherActiveLoading) ? "FINALIZADO" : "EM_ANDAMENTO",
        "AGUARDANDO" => $hasOtherActiveLoading ? "EM_ANDAMENTO" : "AGUARDANDO",
        default => "EM_ANDAMENTO",
    };
    $connection->prepare(
        "UPDATE romaneios SET status = :status
         WHERE id = :id AND company_id = :company_id",
    )->execute([
        "status" => $status,
        "id" => $manifestId,
        "company_id" => $companyId,
    ]);
};

$upsertLoading = static function (PDO $connection, int $companyId, int $sourceLoadingId, array $data) use ($upsertManifest, $upsertTruck, $replaceManifestItems, $upsertProduct, $findEquipment, $syncManifestStatus): array {
    $knownRemoteLoadingId = filter_var($data["remote_carregamento_id"] ?? null, FILTER_VALIDATE_INT);
    $knownRemoteLoadingId = $knownRemoteLoadingId !== false && $knownRemoteLoadingId !== null && $knownRemoteLoadingId > 0
        ? (int) $knownRemoteLoadingId : null;
    $sourceLoadingId = filter_var($data["source_carregamento_id"] ?? $sourceLoadingId, FILTER_VALIDATE_INT);
    $sourceLoadingId = $sourceLoadingId !== false && $sourceLoadingId !== null && $sourceLoadingId > 0
        ? (int) $sourceLoadingId : 0;
    if ($sourceLoadingId < 1) {
        throw new RuntimeException("Identificador do carregamento recebido pela sincronização é inválido.");
    }
    $manifestData = is_array($data["romaneio"] ?? null) ? $data["romaneio"] : $data;
    $manifest = $upsertManifest(
        $connection,
        $companyId,
        (int) ($data["source_romaneio_id"] ?? ($data["romaneio_id"] ?? 0)),
        $manifestData,
    );
    $truckData = is_array($data["truck"] ?? null) ? $data["truck"] : $data;
    $truck = $upsertTruck($connection, (int) $manifest["id"], $truckData);
    $equipmentId = $findEquipment($connection, $companyId, $data);
    $state = strtoupper(trim((string) ($data["state"] ?? "PREPARANDO")));
    $allowedStates = ["AGUARDANDO", "PREPARANDO", "CARREGANDO", "PAUSADO", "FINALIZANDO", "EMERGENCIA", "FINALIZADO"];
    if (!in_array($state, $allowedStates, true)) {
        throw new RuntimeException("Estado de carregamento recebido pela sincronização é inválido.");
    }
    $find = $knownRemoteLoadingId === null
        ? $connection->prepare(
            "SELECT id FROM carregamentos WHERE company_id = :company_id
             AND remote_carregamento_id = :source_id LIMIT 1",
        )
        : $connection->prepare(
            "SELECT id FROM carregamentos WHERE company_id = :company_id
             AND (id = :remote_id OR remote_carregamento_id = :source_id) LIMIT 1",
        );
    $findParams = [
        "company_id" => $companyId,
        "source_id" => $sourceLoadingId,
    ];
    if ($knownRemoteLoadingId !== null) {
        $findParams["remote_id"] = $knownRemoteLoadingId;
    }
    $find->execute($findParams);
    $loadingId = (int) ($find->fetchColumn() ?: 0);
    $values = [
        "remote_id" => $sourceLoadingId,
        "equipment_id" => $equipmentId,
        "romaneio_id" => $manifest["id"],
        "truck_id" => $truck["id"],
        "state" => $state,
        "started_at" => $data["started_at"] ?? date("Y-m-d H:i:s"),
        "company_id" => $companyId,
    ];
    if ($loadingId > 0) {
        $connection->prepare(
            "UPDATE carregamentos SET remote_carregamento_id = :remote_id,
             equipment_id = :equipment_id, romaneio_id = :romaneio_id,
             truck_id = :truck_id, state = :state, started_at = :started_at
             WHERE id = :id AND company_id = :company_id",
        )->execute([...$values, "id" => $loadingId]);
    } else {
        $connection->prepare(
            "INSERT INTO carregamentos
             (company_id, remote_carregamento_id, equipment_id, romaneio_id, truck_id, state, started_at)
             VALUES (:company_id, :remote_id, :equipment_id, :romaneio_id, :truck_id, :state, :started_at)",
        )->execute($values);
        $loadingId = (int) $connection->lastInsertId();
    }
    if (isset($data["items"]) && is_array($data["items"]) && $data["items"] !== []) {
        $replaceManifestItems($connection, $companyId, (int) $manifest["id"], (int) $truck["id"], $data["items"], $upsertProduct);
    }
    $syncManifestStatus($connection, $companyId, $loadingId, $state);
    return [
        "id" => $loadingId,
        "manifest_id" => (int) $manifest["id"],
        "truck_id" => (int) $truck["id"],
        "equipment_id" => $equipmentId,
    ];
};

$resolveLoadingId = static function (PDO $connection, int $companyId, int $candidateId, int $sourceId = 0): ?int {
    if ($candidateId <= 0 && $sourceId <= 0) {
        return null;
    }
    $statement = $connection->prepare(
        "SELECT id FROM carregamentos WHERE company_id = :company_id
         AND ((:candidate_a > 0 AND id = :candidate_b)
           OR (:source_a > 0 AND remote_carregamento_id = :source_b)) LIMIT 1",
    );
    $statement->execute([
        "company_id" => $companyId,
        "candidate_a" => $candidateId,
        "candidate_b" => $candidateId,
        "source_a" => $sourceId,
        "source_b" => $sourceId,
    ]);
    $id = $statement->fetchColumn();
    return $id === false ? null : (int) $id;
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
        $isReplaySafeEvent = in_array($action, [
            "DALA_CADASTRADA",
            "DALA_ATUALIZADA",
            "DALA_EXCLUIDA",
            "PRODUTO_CADASTRADO",
            "PRODUTO_ATUALIZADO",
            "ROMANEIO_CRIADO",
            "ROMANEIO_ATUALIZADO",
            "ROMANEIO_CANCELADO",
            "CARREGAMENTO_PREPARADO",
            "CARREGAMENTO_DALA_DESVINCULADO",
            "CARREGAMENTO_DALA_VINCULADO",
            "ESTADO_CARREGAMENTO_ALTERADO",
            "CARREGAMENTO_FINALIZADO",
        ], true);
        $existing = $pdo->prepare(
            "SELECT id FROM logs_auditoria WHERE company_id = :company_id AND event_uuid = :event_uuid LIMIT 1",
        );
        $existing->execute(["company_id" => $companyId, "event_uuid" => $eventUuid]);
        $replay = (bool) $existing->fetchColumn();
        if ($replay && !$isReplaySafeEvent) {
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

        if (in_array($action, ["PRODUTO_CADASTRADO", "PRODUTO_ATUALIZADO"], true)) {
            $entityId = $upsertProduct($pdo, $companyId, $data);
        }

        if (in_array($action, ["ROMANEIO_CRIADO", "ROMANEIO_ATUALIZADO", "ROMANEIO_CANCELADO"], true)) {
            $manifest = $upsertManifest($pdo, $companyId, $entityId, $data);
            $truck = null;
            if (is_array($data["truck"] ?? null)) {
                $truck = $upsertTruck($pdo, (int) $manifest["id"], $data["truck"]);
            }
            if ($truck !== null && isset($data["items"]) && is_array($data["items"])) {
                $replaceManifestItems(
                    $pdo,
                    $companyId,
                    (int) $manifest["id"],
                    (int) $truck["id"],
                    $data["items"],
                    $upsertProduct,
                );
            }
            $entityId = (int) $manifest["id"];
            $mappings[] = [
                "event_uuid" => $eventUuid,
                "aggregate_type" => $entityType,
                "aggregate_id" => (int) ($event["aggregate_id"] ?? 0),
                "local" => [
                    "romaneio_id" => (int) ($event["aggregate_id"] ?? 0),
                    "truck_id" => is_array($data["truck"] ?? null) ? (int) ($data["truck"]["source_truck_id"] ?? 0) : 0,
                ],
                "remote" => [
                    "romaneio_id" => (int) $manifest["id"],
                    "truck_id" => $truck === null ? 0 : (int) $truck["id"],
                ],
            ];
        }

        if ($action === "CARREGAMENTO_PREPARADO") {
            $loading = $upsertLoading($pdo, $companyId, $entityId, $data);
            $entityId = (int) $loading["id"];
            $mappings[] = [
                "event_uuid" => $eventUuid,
                "aggregate_type" => $entityType,
                "aggregate_id" => (int) ($event["aggregate_id"] ?? 0),
                "local" => [
                    "carregamento_id" => (int) ($event["aggregate_id"] ?? 0),
                    "romaneio_id" => (int) ($data["romaneio_id"] ?? 0),
                    "truck_id" => (int) ($data["truck_id"] ?? ($data["truck"]["source_truck_id"] ?? 0)),
                    "equipment_id" => (int) ($data["equipment_id"] ?? 0),
                ],
                "remote" => [
                    "carregamento_id" => (int) $loading["id"],
                    "romaneio_id" => (int) $loading["manifest_id"],
                    "truck_id" => (int) $loading["truck_id"],
                    "equipment_id" => $loading["equipment_id"] === null ? 0 : (int) $loading["equipment_id"],
                ],
            ];
        }

        if (in_array($action, ["CARREGAMENTO_DALA_DESVINCULADO", "CARREGAMENTO_DALA_VINCULADO"], true)) {
            $remoteLoadingId = filter_var($data["remote_carregamento_id"] ?? null, FILTER_VALIDATE_INT);
            $candidateLoadingId = $remoteLoadingId !== false && $remoteLoadingId > 0
                ? (int) $remoteLoadingId
                : 0;
            $loadingId = $resolveLoadingId(
                $pdo,
                $companyId,
                $candidateLoadingId,
                (int) ($data["source_carregamento_id"] ?? $entityId),
            );
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
            if (in_array($state, ["AGUARDANDO", "PREPARANDO", "CARREGANDO", "PAUSADO", "FINALIZANDO", "EMERGENCIA"], true)) {
                $loadingId = $resolveLoadingId(
                    $pdo,
                    $companyId,
                    $remoteLoadingId !== false && $remoteLoadingId > 0 ? (int) $remoteLoadingId : 0,
                    (int) ($data["source_carregamento_id"] ?? $entityId),
                );
                if ($loadingId !== null) {
                    $update = $pdo->prepare("UPDATE carregamentos SET state = :state WHERE id = :id AND company_id = :company_id");
                    $update->execute(["state" => $state, "id" => $loadingId, "company_id" => $companyId]);
                    $syncManifestStatus($pdo, $companyId, $loadingId, $state);
                    $entityId = $loadingId;
                }
            }
        }

        if ($action === "CARREGAMENTO_FINALIZADO") {
            $remoteLoadingId = filter_var($data["remote_carregamento_id"] ?? null, FILTER_VALIDATE_INT);
            $loadingId = $resolveLoadingId(
                $pdo,
                $companyId,
                $remoteLoadingId !== false && $remoteLoadingId > 0 ? (int) $remoteLoadingId : 0,
                (int) ($data["source_carregamento_id"] ?? $entityId),
            );
            if ($loadingId !== null) {
                $pdo->prepare(
                    "UPDATE carregamentos SET state = 'FINALIZADO', finished_at = COALESCE(finished_at, NOW())
                     WHERE id = :id AND company_id = :company_id",
                )->execute(["id" => $loadingId, "company_id" => $companyId]);
                $syncManifestStatus(
                    $pdo,
                    $companyId,
                    $loadingId,
                    "FINALIZADO",
                    filter_var($data["romaneio_finalizado"] ?? false, FILTER_VALIDATE_BOOLEAN),
                );
                $entityId = $loadingId;
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

        if ($action === "DALA_CADASTRADA" || $action === "DALA_ATUALIZADA") {
            $mappings[] = [
                "event_uuid" => $eventUuid,
                "aggregate_type" => $entityType,
                "aggregate_id" => (int) ($event["aggregate_id"] ?? 0),
                "local" => ["equipment_id" => (int) ($event["aggregate_id"] ?? 0)],
                "remote" => ["equipment_id" => $entityId],
            ];
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

responder_json(["data" => ["processed" => $processed, "ignored" => $ignored, "mappings" => $mappings]]);
