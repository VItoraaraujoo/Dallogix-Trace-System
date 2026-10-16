<?php

declare(strict_types=1);

require_once __DIR__ . "/../../configuracao/bootstrap.php";
require_once __DIR__ . "/../../src/Aplicacao/ServicoLeituras.php";

use App\Aplicacao\ServicoLeituras;

$usuarioAtor = exigir_sessao_usuario();
if ($usuarioAtor["company_id"] === null) {
    responder_json(["error" => "Usuário sem empresa vinculada."], 403);
}
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $loadingId = filter_var($_GET["carregamento_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$loadingId) responder_json(["error" => "Carregamento obrigatório."], 422);
    $page = filter_var($_GET["page"] ?? 1, FILTER_VALIDATE_INT);
    $page = $page === false ? 1 : max(1, (int) $page);
    session_write_close();
    $pendencias = (new ServicoLeituras(obter_conexao_banco()))->listarPendentes(
        (int) $usuarioAtor["company_id"],
        (int) $loadingId,
        $page,
    );
    responder_json($pendencias);
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    responder_json(["error" => "Método não permitido."], 405);
}
exigir_csrf();
session_write_close();

$payload = ler_json_da_requisicao();
$loadingId = filter_var(
    $payload["carregamento_id"] ?? null,
    FILTER_VALIDATE_INT,
);
$sensorEventId = filter_var(
    $payload["sensor_event_id"] ?? null,
    FILTER_VALIDATE_INT,
);
$barcode = trim((string) ($payload["barcode"] ?? ""));
$offlineEventId = trim((string) ($_SERVER["HTTP_X_TRACE_OFFLINE_ID"] ?? ""));
if ($offlineEventId !== "" && preg_match('/^[a-f0-9-]{16,36}$/i', $offlineEventId) !== 1) {
    responder_json(["error" => "Identificador da leitura inválido."], 422);
}
$attemptNumber = filter_var(
    $payload["attempt_number"] ?? 1,
    FILTER_VALIDATE_INT,
);
if (!$loadingId) {
    json_response(["error" => "Carregamento obrigatório."], 422);
}
if (mb_strlen($barcode, "UTF-8") > 128 || preg_match('/[\x00-\x1F\x7F]/', $barcode) === 1) {
    json_response(["error" => "Código de barras inválido ou longo demais."], 422);
}
if ($attemptNumber !== 1) {
    json_response(
        ["error" => "Cada saco possui uma única tentativa de leitura."],
        422,
    );
}

$pdo = db();
$pdo->beginTransaction();
register_shutdown_function(static function () use ($pdo): void {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
});
$loadingStatement = $pdo->prepare(
    'SELECT c.id, c.state, c.romaneio_id, c.truck_id, c.equipment_id
     FROM carregamentos c
     WHERE c.id = :id AND c.company_id = :company_id LIMIT 1 FOR UPDATE',
);
$loadingStatement->execute([
    "id" => $loadingId,
    "company_id" => $usuarioAtor["company_id"],
]);
$loading = $loadingStatement->fetch();
if (!$loading) {
    $pdo->rollBack();
    responder_json(
        ["error" => "Carregamento não encontrado para esta empresa."],
        404,
    );
}
if ($offlineEventId !== "") {
    $previous = $pdo->prepare(
        "SELECT entity_id, metadata FROM logs_auditoria
         WHERE company_id = :company_id AND event_uuid = :event_uuid
           AND action = 'LEITURA_REGISTRADA' LIMIT 1",
    );
    $previous->execute([
        "company_id" => $usuarioAtor["company_id"],
        "event_uuid" => $offlineEventId,
    ]);
    $registered = $previous->fetch();
    if ($registered) {
        $original = json_decode((string) $registered["metadata"], true);
        if (
            !is_array($original) ||
            (int) ($original["carregamento_id"] ?? 0) !== (int) $loadingId ||
            (string) ($original["barcode"] ?? "") !== $barcode
        ) {
            $pdo->rollBack();
            responder_json(["error" => "Identificador já usado em outra leitura."], 409);
        }
        $originalReading = $pdo->prepare(
            "SELECT id, result FROM leituras
             WHERE id = :id AND company_id = :company_id AND carregamento_id = :carregamento_id LIMIT 1",
        );
        $originalReading->execute([
            "id" => $registered["entity_id"],
            "company_id" => $usuarioAtor["company_id"],
            "carregamento_id" => $loadingId,
        ]);
        $reading = $originalReading->fetch();
        $pdo->rollBack();
        if (!$reading) {
            responder_json(["error" => "Leitura original não está mais disponível para reenvio."], 409);
        }
        responder_json([
            "data" => [
                "id" => (int) $reading["id"],
                "result" => $reading["result"],
                "duplicate" => true,
                "load_status" => in_array($loading["state"], ["FINALIZANDO", "FINALIZADO"], true)
                    ? "COMPLETO" : "EM_ANDAMENTO",
            ],
        ], 200);
    }
}
if ($loading["state"] === "EMERGENCIA") {
    $pdo->rollBack();
    responder_json(
        [
            "error" =>
            "Contagem bloqueada: a máquina está em emergência. Libere a máquina antes de registrar leituras.",
        ],
        423,
    );
}
if ($loading["state"] !== "CARREGANDO") {
    $pdo->rollBack();
    responder_json(
        ["error" => "Leitura ignorada: a esteira está em {$loading["state"]}."],
        409,
    );
}

$plannedStatement = $pdo->prepare(
    "SELECT COALESCE(SUM(ri.planned_quantity), 0) FROM romaneio_itens ri WHERE ri.romaneio_id = :romaneio_id AND (ri.truck_id = :truck_id OR ri.truck_id IS NULL)",
);
$plannedStatement->execute([
    "romaneio_id" => $loading["romaneio_id"],
    "truck_id" => $loading["truck_id"],
]);
$plannedQuantity = (int) $plannedStatement->fetchColumn();
$validCountStatement = $pdo->prepare(
    "SELECT leituras_validas FROM carregamentos WHERE id = :carregamento_id FOR UPDATE",
);
$validCountStatement->execute(["carregamento_id" => $loadingId]);
$validCount = (int) $validCountStatement->fetchColumn();
if ($sensorEventId) {
    $sensorStatement = $pdo->prepare(
        "SELECT id FROM eventos_sensor WHERE id = :sensor_event_id AND carregamento_id = :carregamento_id AND equipment_id = :equipment_id LIMIT 1",
    );
    $sensorStatement->execute([
        "sensor_event_id" => $sensorEventId,
        "carregamento_id" => $loadingId,
        "equipment_id" => $loading["equipment_id"],
    ]);
    if (!$sensorStatement->fetch()) {
        $pdo->rollBack();
        responder_json(
            ["error" => "Evento de sensor não pertence ao carregamento."],
            422,
        );
    }
}

$result = "SEM_LEITURA";
$productId = null;
$productPlannedQuantity = 0;
$productValidCount = 0;
if ($barcode !== "") {
    $productStatement = $pdo->prepare(
        'SELECT p.id
         FROM codigos_produtos pc
         JOIN produtos p ON p.id = pc.product_id AND p.company_id = :company_id
         WHERE pc.barcode = :barcode AND p.active = 1 LIMIT 1',
    );
    $productStatement->execute([
        "company_id" => $usuarioAtor["company_id"],
        "barcode" => $barcode,
    ]);
    $product = $productStatement->fetch();
    if ($product) {
        $plannedStatement = $pdo->prepare(
            "SELECT COALESCE(SUM(ri.planned_quantity), 0) AS planned_quantity,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM leituras l
                        WHERE l.carregamento_id = :carregamento_id
                          AND l.product_id = :count_product_id
                          AND l.result = 'VALIDO'
                    ), 0) AS valid_count
             FROM romaneio_itens ri
             WHERE ri.romaneio_id = :romaneio_id
               AND ri.product_id = :product_id
               AND (ri.truck_id = :truck_id OR ri.truck_id IS NULL)",
        );
        $plannedStatement->execute([
            "carregamento_id" => $loadingId,
            "count_product_id" => $product["id"],
            "romaneio_id" => $loading["romaneio_id"],
            "product_id" => $product["id"],
            "truck_id" => $loading["truck_id"],
        ]);
        $productPlan = $plannedStatement->fetch() ?: [];
        $productPlannedQuantity = (int) ($productPlan["planned_quantity"] ?? 0);
        $productValidCount = (int) ($productPlan["valid_count"] ?? 0);
        if ($productPlannedQuantity > 0) {
            $productId = (int) $product["id"];
            $result = "VALIDO";
        } else {
            $result = "PRODUTO_INCORRETO";
        }
    } else {
        $result = "PRODUTO_INCORRETO";
    }
}
if (
    $result === "VALIDO" &&
    $productPlannedQuantity > 0 &&
    $productValidCount >= $productPlannedQuantity
) {
    $result = "EXCESSO";
}
if ($result === "VALIDO" && $plannedQuantity > 0 && $validCount >= $plannedQuantity) {
    $result = "EXCESSO";
}

$endProductAlert = null;
$alertThreshold = limite_alerta_fim_produto_sacas();
if ($result === "VALIDO" && $productId !== null && $productPlannedQuantity > 0) {
    $productValidCountAfter = $productValidCount + 1;
    $productRemainingAfter = max(0, $productPlannedQuantity - $productValidCountAfter);
    $alertAlreadyRecorded = false;
    if ($productRemainingAfter > 0 && $productRemainingAfter <= $alertThreshold) {
        $alertStatement = $pdo->prepare(
            "SELECT 1
             FROM logs_auditoria
             WHERE company_id = :company_id
               AND action = 'ALERTA_FIM_PRODUTO'
               AND entity_type = 'carregamento'
               AND entity_id = :carregamento_id
               AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.product_id')) = :product_id
             LIMIT 1",
        );
        $alertStatement->execute([
            "company_id" => $usuarioAtor["company_id"],
            "carregamento_id" => $loadingId,
            "product_id" => $productId,
        ]);
        $alertAlreadyRecorded = (bool) $alertStatement->fetchColumn();
    }
    if ($productRemainingAfter > 0 && $productRemainingAfter <= $alertThreshold && !$alertAlreadyRecorded) {
        $endProductAlert = sprintf(
            "Faltam %d sacas para finalizar o produto.",
            $productRemainingAfter,
        );
    }
}

$insert = $pdo->prepare(
    "INSERT INTO leituras (company_id, carregamento_id, sensor_event_id, product_id, barcode, attempt_number, result, read_at) VALUES (:company_id, :carregamento_id, :sensor_event_id, :product_id, :barcode, :attempt_number, :result, NOW(3))",
);
try {
    $insert->execute([
        "company_id" => $usuarioAtor["company_id"],
        "carregamento_id" => $loadingId,
        "sensor_event_id" => $sensorEventId ?: null,
        "product_id" => $productId,
        "barcode" => $barcode !== "" ? $barcode : null,
        "attempt_number" => $attemptNumber,
        "result" => $result,
    ]);
} catch (PDOException $exception) {
    if (
        $sensorEventId &&
        isset($exception->errorInfo[1]) &&
        (int) $exception->errorInfo[1] === 1062
    ) {
        $existing = $pdo->prepare(
            "SELECT id, result FROM leituras WHERE sensor_event_id = :sensor_event_id LIMIT 1",
        );
        $existing->execute(["sensor_event_id" => $sensorEventId]);
        $reading = $existing->fetch();
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        responder_json(
            [
                "data" => [
                    "id" => (int) $reading["id"],
                    "result" => $reading["result"],
                    "duplicate" => true,
                    "retry" => false,
                    "final" => true,
                ],
            ],
            200,
        );
    }
    throw $exception;
}
$readingId = (int) $pdo->lastInsertId();
if ($result === "VALIDO") {
    $validCounter = $pdo->prepare(
        "UPDATE carregamentos SET leituras_validas = leituras_validas + 1 WHERE id = :id AND company_id = :company_id",
    );
    $validCounter->execute(["id" => $loadingId, "company_id" => $usuarioAtor["company_id"]]);
}
if ($endProductAlert !== null) {
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "ALERTA_FIM_PRODUTO",
        "carregamento",
        (int) $loadingId,
        [
            "carregamento_id" => (int) $loadingId,
            "leitura_id" => $readingId,
            "product_id" => $productId,
            "planned_quantity" => $productPlannedQuantity,
            "valid_readings" => $productValidCount + 1,
            "remaining_quantity" => max(0, $productPlannedQuantity - ($productValidCount + 1)),
            "threshold" => $alertThreshold,
            "message" => $endProductAlert,
        ],
    );
}
record_operational_event(
    $pdo,
    $usuarioAtor,
    "LEITURA_REGISTRADA",
    "leitura",
    $readingId,
    [
        "carregamento_id" => (int) $loadingId,
        "result" => $result,
        "barcode" => $barcode,
        "attempt_number" => $attemptNumber,
        ...($offlineEventId !== "" ? ["event_uuid" => $offlineEventId] : []),
    ],
);
$occurrenceId = null;
$cameraStatus = "NAO_SOLICITADA";
if ($result === "SEM_LEITURA") {
    $occurrence = $pdo->prepare(
        'INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, \'FALHA_SEM_LEITURA\', 1, :description, :created_by)',
    );
    $occurrence->execute([
        "company_id" => $usuarioAtor["company_id"],
        "carregamento_id" => $loadingId,
        "description" =>
        "Saco detectado pelo sensor sem código de barras válido.",
        "created_by" => $usuarioAtor["id"],
    ]);
    $occurrenceId = (int) $pdo->lastInsertId();
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "FALHA_SEM_LEITURA",
        "ocorrencia",
        $occurrenceId,
        ["carregamento_id" => (int) $loadingId, "leitura_id" => $readingId],
    );
    $cameraStatus = "CAPTURA_PENDENTE_INCIDENTE";
}
if ($result === "PRODUTO_INCORRETO") {
    $occurrence = $pdo->prepare(
        'INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, \'PRODUTO_INCORRETO\', 1, :description, :created_by)',
    );
    $occurrence->execute([
        "company_id" => $usuarioAtor["company_id"],
        "carregamento_id" => $loadingId,
        "description" => "Produto lido não está previsto para o carregamento.",
        "created_by" => $usuarioAtor["id"],
    ]);
    $occurrenceId = (int) $pdo->lastInsertId();
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "PRODUTO_INCORRETO",
        "ocorrencia",
        $occurrenceId,
        ["carregamento_id" => (int) $loadingId, "leitura_id" => $readingId],
    );
    $cameraStatus = "CAPTURA_PENDENTE_INCIDENTE";
}
if ($result === "EXCESSO") {
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "EXCESSO_DETECTADO",
        "leitura",
        $readingId,
        ["carregamento_id" => (int) $loadingId, "product_id" => $productId],
    );
}
if ($result === "PRODUTO_INCORRETO") {
    $stopReason = "PRODUTO_INCORRETO";
    $stopAlert = "Produto incorreto detectado. Remova a unidade e confirme para continuar.";
    $stop = $pdo->prepare(
        "UPDATE carregamentos SET state = 'PAUSADO', stop_reason = :stop_reason, operator_alert = :operator_alert WHERE id = :id AND company_id = :company_id AND state = 'CARREGANDO'",
    );
    $stop->execute([
        "stop_reason" => $stopReason,
        "operator_alert" => $stopAlert,
        "id" => $loadingId,
        "company_id" => $usuarioAtor["company_id"],
    ]);
    $pendingStop = $pdo->prepare(
        "SELECT id FROM solicitacoes_comandos_clp
         WHERE carregamento_id = :carregamento_id AND company_id = :company_id
           AND command = 'PAUSAR_CARREGAMENTO'
           AND status IN ('PENDENTE', 'PROCESSANDO')
         ORDER BY id DESC LIMIT 1 FOR UPDATE",
    );
    $pendingStop->execute([
        "carregamento_id" => $loadingId,
        "company_id" => $usuarioAtor["company_id"],
    ]);
    $pauseCommandRequestId = (int) ($pendingStop->fetchColumn() ?: 0);
    if ($pauseCommandRequestId < 1) {
        $queueStop = $pdo->prepare(
            "INSERT INTO solicitacoes_comandos_clp
             (company_id, equipment_id, carregamento_id, command, requested_by)
             VALUES (:company_id, :equipment_id, :carregamento_id, 'PAUSAR_CARREGAMENTO', :requested_by)",
        );
        $queueStop->execute([
            "company_id" => $usuarioAtor["company_id"],
            "equipment_id" => $loading["equipment_id"],
            "carregamento_id" => $loadingId,
            "requested_by" => $usuarioAtor["id"],
        ]);
        $pauseCommandRequestId = (int) $pdo->lastInsertId();
    }
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "ESTEIRA_PAUSADA_AUTOMATICAMENTE",
        "carregamento",
        (int) $loadingId,
        [
            "reason" => $stopReason,
            "safe_physical_action" => "gateway_clp_required",
            "command_request_id" => $pauseCommandRequestId,
        ],
    );
}
if (
    in_array($result, ["SEM_LEITURA", "PRODUTO_INCORRETO"], true) &&
    $sensorEventId
) {
    $cameraRequest = $pdo->prepare(
        'INSERT INTO solicitacoes_captura_camera (sensor_event_id, carregamento_id, equipment_id, reason, requested_at)
         VALUES (:sensor_event_id, :carregamento_id, :equipment_id, :reason, NOW(3))
         ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = IF(status = \'ERRO\', \'PENDENTE\', status), requested_at = VALUES(requested_at)',
    );
    $cameraRequest->execute([
        "sensor_event_id" => $sensorEventId,
        "carregamento_id" => $loadingId,
        "equipment_id" => $loading["equipment_id"],
        "reason" => $result,
    ]);
    $cameraIdStatement = $pdo->prepare(
        "SELECT id FROM solicitacoes_captura_camera WHERE sensor_event_id = :sensor_event_id LIMIT 1",
    );
    $cameraIdStatement->execute(["sensor_event_id" => $sensorEventId]);
    $cameraRequestId = (int) ($cameraIdStatement->fetchColumn() ?: 0);
    if ($cameraRequestId < 1) {
        throw new RuntimeException("Solicitação de captura da câmera não encontrada após gravação.");
    }
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "CAMERA_CAPTURA_SOLICITADA",
        "camera_request",
        $cameraRequestId,
        ["sensor_event_id" => $sensorEventId, "reason" => $result],
    );
    $cameraStatus = "CAPTURA_PENDENTE_INCIDENTE";
}
$loadStatus = "EM_ANDAMENTO";
if (
    $result === "VALIDO" &&
    $plannedQuantity > 0 &&
    $validCount + 1 >= $plannedQuantity
) {
    $trigger = $pdo->prepare(
        "SELECT a.id, a.comando, a.rotulo
         FROM gatilhos_dala g
         JOIN acoes_dala a ON a.id = g.acao_id AND a.visivel = 1
           AND a.company_id = g.company_id AND a.equipment_id = g.equipment_id
         WHERE g.company_id = :company_id AND g.equipment_id = :equipment_id
           AND g.evento = 'QUANTIDADE_PLANEJADA_ATINGIDA' AND g.ativo = 1
         LIMIT 1",
    );
    $trigger->execute([
        "company_id" => $usuarioAtor["company_id"],
        "equipment_id" => $loading["equipment_id"],
    ]);
    $configuredAction = $trigger->fetch();
    $stateUpdate = $pdo->prepare(
        "UPDATE carregamentos SET state = 'FINALIZANDO' WHERE id = :id AND company_id = :company_id AND state IN ('PREPARANDO', 'CARREGANDO', 'PAUSADO')",
    );
    $stateUpdate->execute(["id" => $loadingId, "company_id" => $usuarioAtor["company_id"]]);
    if ($configuredAction) {
        $queue = $pdo->prepare(
            "INSERT INTO solicitacoes_comandos_clp (company_id, equipment_id, carregamento_id, command, requested_by)
             VALUES (:company_id, :equipment_id, :carregamento_id, :command, :requested_by)",
        );
        $queue->execute([
            "company_id" => $usuarioAtor["company_id"],
            "equipment_id" => $loading["equipment_id"],
            "carregamento_id" => $loadingId,
            "command" => $configuredAction["comando"],
            "requested_by" => $usuarioAtor["id"],
        ]);
        record_operational_event(
            $pdo,
            $usuarioAtor,
            "GATILHO_DALA_DISPARADO",
            "solicitacao_comando_clp",
            (int) $pdo->lastInsertId(),
            [
                "carregamento_id" => (int) $loadingId,
                "evento" => "QUANTIDADE_PLANEJADA_ATINGIDA",
                "acao" => $configuredAction["comando"],
                "rotulo" => $configuredAction["rotulo"],
                "gateway_clp_required" => true,
            ],
        );
    }
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "QUANTIDADE_PLANEJADA_ATINGIDA",
        "carregamento",
        (int) $loadingId,
        [
            "planned_quantity" => $plannedQuantity,
            "valid_readings" => $validCount + 1,
            "gatilho_configurado" => $configuredAction["comando"] ?? null,
        ],
    );
    $loadStatus = "COMPLETO";
}
$pdo->commit();
responder_json(
    [
        "data" => [
            "id" => $readingId,
            "result" => $result,
            "barcode" => $barcode !== "" ? $barcode : null,
            "attempt_number" => $attemptNumber,
            "retry" => false,
            "final" => true,
            "occurrence_id" => $occurrenceId,
            "camera_status" => $cameraStatus,
            "load_status" => $loadStatus,
            "excesso" => $result === "EXCESSO",
            "stop_reason" => $result === "PRODUTO_INCORRETO" ? $result : null,
            "operator_alert" => $result === "EXCESSO"
                ? "Quantidade prevista para este produto atingida. Confira a leitura excedente."
                : ($stopAlert ?? $endProductAlert),
            "pause_command_request_id" => $pauseCommandRequestId ?? null,
            "end_product_alert" => $endProductAlert,
        ],
    ],
    201,
);
