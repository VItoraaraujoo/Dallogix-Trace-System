<?php
declare(strict_types=1);

require_once __DIR__ . "/../../configuracao/bootstrap.php";
require_once __DIR__ . "/../../src/Aplicacao/ClassificadorLeitura.php";
require_once __DIR__ . "/../../src/Persistencia/RepositorioLeituras.php";

use App\Aplicacao\ClassificadorLeitura;
use App\Persistencia\RepositorioLeituras;

$user = require_role(["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"]);
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();

$payload = request_json();
$readingId = filter_var($payload["leitura_id"] ?? null, FILTER_VALIDATE_INT);
$barcode = trim((string) ($payload["barcode"] ?? ""));
$productId = array_key_exists("product_id", $payload)
    ? filter_var($payload["product_id"], FILTER_VALIDATE_INT)
    : null;
$offlineEventId = trim((string) ($_SERVER["HTTP_X_TRACE_OFFLINE_ID"] ?? ""));
if (
    !$readingId ||
    $barcode === "" ||
    (array_key_exists("product_id", $payload) && (!$productId || $productId === false))
) {
    json_response(["error" => "Leitura e código de barras são obrigatórios."], 422);
}
if (mb_strlen($barcode, "UTF-8") > 80) {
    json_response(["error" => "O código de barras excede o limite de 80 caracteres."], 422);
}
$offlineEventId = preg_match('/^[a-f0-9-]{16,80}$/i', $offlineEventId) ? $offlineEventId : "";

$pdo = db();
if ($offlineEventId !== "") {
    $duplicate = $pdo->prepare(
        "SELECT action, entity_type, entity_id
         FROM logs_auditoria
         WHERE event_uuid = :event_uuid AND company_id = :company_id
         LIMIT 1",
    );
    $duplicate->execute([
        "event_uuid" => $offlineEventId,
        "company_id" => $user["company_id"],
    ]);
    $registeredEvent = $duplicate->fetch();
    if ($registeredEvent) {
        if (
            $registeredEvent["action"] !== "LEITURA_IDENTIFICADA_MANUALMENTE" ||
            $registeredEvent["entity_type"] !== "leitura" ||
            (int) $registeredEvent["entity_id"] !== (int) $readingId
        ) {
            json_response(["error" => "Identificador offline já utilizado em outra operação."], 409);
        }
        $registeredReading = $pdo->prepare(
            "SELECT l.id, l.result, l.product_id, l.barcode, p.name AS product_name
             FROM leituras l
             LEFT JOIN produtos p ON p.id = l.product_id AND p.company_id = l.company_id
             WHERE l.id = :id AND l.company_id = :company_id
             LIMIT 1",
        );
        $registeredReading->execute([
            "id" => (int) $readingId,
            "company_id" => $user["company_id"],
        ]);
        $registered = $registeredReading->fetch();
        if (!$registered || (string) $registered["barcode"] !== $barcode) {
            json_response(["error" => "Identificador offline já utilizado para outro código."], 409);
        }
        json_response([
            "data" => [
                "id" => (int) $registered["id"],
                "result" => $registered["result"],
                "product_id" => $registered["product_id"] === null ? null : (int) $registered["product_id"],
                "product_name" => $registered["product_name"],
                "duplicate" => true,
            ],
        ]);
    }
}

$pdo->beginTransaction();
try {
    // Segue a mesma ordem de bloqueio da rota do scanner: carregamento e depois leitura.
    // Isso serializa a contagem e evita deadlock com uma passagem simultânea.
    $loadingIdLookup = $pdo->prepare(
        "SELECT carregamento_id FROM leituras
         WHERE id = :id AND company_id = :company_id
         LIMIT 1",
    );
    $loadingIdLookup->execute([
        "id" => (int) $readingId,
        "company_id" => (int) $user["company_id"],
    ]);
    $loadingId = $loadingIdLookup->fetchColumn();
    if ($loadingId === false) {
        $pdo->rollBack();
        json_response(["error" => "Leitura não encontrada."], 404);
    }
    $loadingStatement = $pdo->prepare(
        "SELECT id, state, romaneio_id, truck_id, equipment_id, leituras_validas
         FROM carregamentos
         WHERE id = :id AND company_id = :company_id
         LIMIT 1 FOR UPDATE",
    );
    $loadingStatement->execute([
        "id" => (int) $loadingId,
        "company_id" => (int) $user["company_id"],
    ]);
    $loading = $loadingStatement->fetch();
    if (!$loading) {
        $pdo->rollBack();
        json_response(["error" => "Carregamento não encontrado."], 404);
    }
    if (!in_array($loading["state"], ["CARREGANDO", "PAUSADO"], true)) {
        $pdo->rollBack();
        json_response(["error" => "A leitura só pode ser corrigida enquanto o carregamento estiver CARREGANDO ou PAUSADO."], 409);
    }

    $reading = $pdo->prepare(
        "SELECT id, result
         FROM leituras
         WHERE id = :id AND carregamento_id = :loading_id AND company_id = :company_id
         LIMIT 1 FOR UPDATE",
    );
    $reading->execute([
        "id" => (int) $readingId,
        "loading_id" => (int) $loading["id"],
        "company_id" => $user["company_id"],
    ]);
    $current = $reading->fetch();
    if (!$current) {
        $pdo->rollBack();
        json_response(["error" => "Leitura não encontrada."], 404);
    }
    if ($current["result"] !== "SEM_LEITURA") {
        $pdo->rollBack();
        json_response(["error" => "Somente leituras sem código podem ser identificadas."], 409);
    }

    $productSql =
        "SELECT p.id, p.name
         FROM codigos_produtos pc
         JOIN produtos p ON p.id = pc.product_id AND p.company_id = pc.company_id
         WHERE pc.company_id = :company_id
           AND pc.barcode = :barcode
           AND p.active = 1";
    $productParameters = [
        "company_id" => (int) $user["company_id"],
        "barcode" => $barcode,
    ];
    if ($productId !== null) {
        $productSql .= " AND p.id = :product_id";
        $productParameters["product_id"] = (int) $productId;
    }
    $productSql .= " LIMIT 1";
    $product = $pdo->prepare($productSql);
    $product->execute($productParameters);
    $selected = $product->fetch();
    if (!$selected && $productId !== null) {
        $pdo->rollBack();
        json_response(["error" => "O código não corresponde ao produto selecionado ou o produto está inativo."], 422);
    }

    $matchedProductId = $selected ? (int) $selected["id"] : null;
    $quantities = (new RepositorioLeituras($pdo))->obterQuantidadesParaClassificar(
        (int) $user["company_id"],
        (int) $loading["id"],
        (int) $loading["romaneio_id"],
        $loading["truck_id"] === null ? null : (int) $loading["truck_id"],
        $matchedProductId,
    );
    $classification = (new ClassificadorLeitura())->classificar(
        true,
        $matchedProductId,
        $quantities["product_planned_quantity"],
        $quantities["product_valid_count"],
        $quantities["loading_planned_quantity"],
        (int) $loading["leituras_validas"],
    );
    $result = $classification["result"];
    $classifiedProductId = $classification["product_id"];

    $update = $pdo->prepare(
        "UPDATE leituras
         SET product_id = :product_id, barcode = :barcode, result = :result
         WHERE id = :id AND carregamento_id = :loading_id AND company_id = :company_id AND result = 'SEM_LEITURA'",
    );
    $update->execute([
        "product_id" => $classifiedProductId,
        "barcode" => $barcode,
        "result" => $result,
        "id" => (int) $readingId,
        "loading_id" => (int) $loading["id"],
        "company_id" => (int) $user["company_id"],
    ]);
    if ($update->rowCount() !== 1) {
        $pdo->rollBack();
        json_response(["error" => "A leitura mudou durante a correção. Atualize a tela e tente novamente."], 409);
    }

    if ($result === "VALIDO") {
        $counter = $pdo->prepare(
            "UPDATE carregamentos SET leituras_validas = leituras_validas + 1
             WHERE id = :id AND company_id = :company_id",
        );
        $counter->execute([
            "id" => (int) $loading["id"],
            "company_id" => (int) $user["company_id"],
        ]);
    }

    $occurrenceId = null;
    $pauseCommandRequestId = null;
    $operatorAlert = null;
    if ($result === "PRODUTO_INCORRETO") {
        $operatorAlert = "Produto incorreto identificado. Confira a unidade e mantenha a operação pausada.";
        $occurrence = $pdo->prepare(
            "INSERT INTO ocorrencias
             (company_id, carregamento_id, type, quantity, description, created_by)
             VALUES (:company_id, :loading_id, 'PRODUTO_INCORRETO', 1, :description, :created_by)",
        );
        $occurrence->execute([
            "company_id" => (int) $user["company_id"],
            "loading_id" => (int) $loading["id"],
            "description" => "Produto identificado manualmente não está previsto para o carregamento.",
            "created_by" => $user["id"],
        ]);
        $occurrenceId = (int) $pdo->lastInsertId();
        record_operational_event(
            $pdo,
            $user,
            "PRODUTO_INCORRETO",
            "ocorrencia",
            $occurrenceId,
            ["carregamento_id" => (int) $loading["id"], "leitura_id" => (int) $readingId],
        );

        if ($loading["state"] === "CARREGANDO") {
            $stop = $pdo->prepare(
                "UPDATE carregamentos
                 SET state = 'PAUSADO', stop_reason = 'PRODUTO_INCORRETO', operator_alert = :operator_alert
                 WHERE id = :id AND company_id = :company_id AND state = 'CARREGANDO'",
            );
            $stop->execute([
                "operator_alert" => $operatorAlert,
                "id" => (int) $loading["id"],
                "company_id" => (int) $user["company_id"],
            ]);
        }
        $pendingStop = $pdo->prepare(
            "SELECT id FROM solicitacoes_comandos_clp
             WHERE carregamento_id = :loading_id AND company_id = :company_id
               AND command = 'PAUSAR_CARREGAMENTO'
               AND status IN ('PENDENTE', 'PROCESSANDO')
             ORDER BY id DESC LIMIT 1 FOR UPDATE",
        );
        $pendingStop->execute([
            "loading_id" => (int) $loading["id"],
            "company_id" => (int) $user["company_id"],
        ]);
        $pauseCommandRequestId = (int) ($pendingStop->fetchColumn() ?: 0);
        if ($pauseCommandRequestId < 1) {
            $queueStop = $pdo->prepare(
                "INSERT INTO solicitacoes_comandos_clp
                 (company_id, equipment_id, carregamento_id, command, requested_by)
                 VALUES (:company_id, :equipment_id, :loading_id, 'PAUSAR_CARREGAMENTO', :requested_by)",
            );
            $queueStop->execute([
                "company_id" => (int) $user["company_id"],
                "equipment_id" => (int) $loading["equipment_id"],
                "loading_id" => (int) $loading["id"],
                "requested_by" => $user["id"],
            ]);
            $pauseCommandRequestId = (int) $pdo->lastInsertId();
        }
    } elseif ($result === "EXCESSO") {
        $operatorAlert = "Quantidade prevista para este produto atingida. Confira a leitura excedente.";
        record_operational_event(
            $pdo,
            $user,
            "EXCESSO_DETECTADO",
            "leitura",
            (int) $readingId,
            ["carregamento_id" => (int) $loading["id"], "product_id" => (int) $classifiedProductId],
        );
    }

    $loadStatus = $loading["state"];
    if (
        $result === "VALIDO" &&
        $quantities["loading_planned_quantity"] > 0 &&
        (int) $loading["leituras_validas"] + 1 >= $quantities["loading_planned_quantity"]
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
            "company_id" => (int) $user["company_id"],
            "equipment_id" => (int) $loading["equipment_id"],
        ]);
        $configuredAction = $trigger->fetch();
        $stateUpdate = $pdo->prepare(
            "UPDATE carregamentos SET state = 'FINALIZANDO'
             WHERE id = :id AND company_id = :company_id AND state IN ('CARREGANDO', 'PAUSADO')",
        );
        $stateUpdate->execute([
            "id" => (int) $loading["id"],
            "company_id" => (int) $user["company_id"],
        ]);
        if ($stateUpdate->rowCount() !== 1) {
            $pdo->rollBack();
            json_response(["error" => "O estado do carregamento mudou. Atualize a operação antes de concluir a correção."], 409);
        }
        if ($configuredAction) {
            $queue = $pdo->prepare(
                "INSERT INTO solicitacoes_comandos_clp
                 (company_id, equipment_id, carregamento_id, command, requested_by)
                 VALUES (:company_id, :equipment_id, :loading_id, :command, :requested_by)",
            );
            $queue->execute([
                "company_id" => (int) $user["company_id"],
                "equipment_id" => (int) $loading["equipment_id"],
                "loading_id" => (int) $loading["id"],
                "command" => $configuredAction["comando"],
                "requested_by" => $user["id"],
            ]);
            record_operational_event(
                $pdo,
                $user,
                "GATILHO_DALA_DISPARADO",
                "solicitacao_comando_clp",
                (int) $pdo->lastInsertId(),
                [
                    "carregamento_id" => (int) $loading["id"],
                    "evento" => "QUANTIDADE_PLANEJADA_ATINGIDA",
                    "acao" => $configuredAction["comando"],
                    "rotulo" => $configuredAction["rotulo"],
                    "gateway_clp_required" => true,
                ],
            );
        }
        record_operational_event(
            $pdo,
            $user,
            "QUANTIDADE_PLANEJADA_ATINGIDA",
            "carregamento",
            (int) $loading["id"],
            [
                "planned_quantity" => $quantities["loading_planned_quantity"],
                "valid_readings" => (int) $loading["leituras_validas"] + 1,
                "gatilho_configurado" => $configuredAction["comando"] ?? null,
                "source" => "manual_reading_correction",
            ],
        );
        $loadStatus = "COMPLETO";
    } elseif ($loading["state"] === "CARREGANDO") {
        $loadStatus = "EM_ANDAMENTO";
    }

    record_operational_event(
        $pdo,
        $user,
        "LEITURA_IDENTIFICADA_MANUALMENTE",
        "leitura",
        (int) $readingId,
        [
            "carregamento_id" => (int) $loading["id"],
            "product_id" => $classifiedProductId,
            "scanned_product_id" => $matchedProductId,
            "product_name" => $selected["name"] ?? null,
            "barcode" => $barcode,
            "result" => $result,
            "load_status" => $loadStatus,
            ...( $occurrenceId !== null ? ["occurrence_id" => $occurrenceId] : []),
            ...( $offlineEventId !== "" ? ["event_uuid" => $offlineEventId] : []),
        ],
    );
    $pdo->commit();
    json_response([
        "data" => [
            "id" => (int) $readingId,
            "result" => $result,
            "product_id" => $classifiedProductId,
            "product_name" => $selected["name"] ?? null,
            "barcode" => $barcode,
            "load_status" => $loadStatus,
            "occurrence_id" => $occurrenceId,
            "stop_reason" => $result === "PRODUTO_INCORRETO" ? "PRODUTO_INCORRETO" : null,
            "operator_alert" => $operatorAlert,
            "pause_command_request_id" => $pauseCommandRequestId,
            "excesso" => $result === "EXCESSO",
        ],
    ]);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $exception;
}
