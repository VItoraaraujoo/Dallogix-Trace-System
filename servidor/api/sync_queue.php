<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();
if ($user["company_id"] === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}
$pdo = db();

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $statement = $pdo->prepare(
        'SELECT q.id, q.event_uuid, q.aggregate_type, q.aggregate_id, q.payload, q.status, q.attempts, q.last_error, q.available_at, q.created_at
         FROM fila_sincronizacao q
         WHERE EXISTS (SELECT 1 FROM logs_auditoria a WHERE a.company_id = :company_id AND a.entity_type = q.aggregate_type AND a.entity_id = q.aggregate_id)
         ORDER BY q.id DESC LIMIT 100',
    );
    $statement->execute(["company_id" => $user["company_id"]]);
    json_response(["data" => $statement->fetchAll()]);
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();

$payload = request_json();
$queueId = filter_var($payload["id"] ?? null, FILTER_VALIDATE_INT);
if (!$queueId) {
    json_response(["error" => "Id do evento é obrigatório."], 422);
}

$statement = $pdo->prepare(
    'SELECT q.* FROM fila_sincronizacao q
     WHERE q.id = :id AND q.status IN (\'PENDENTE\', \'ERRO\')
       AND EXISTS (SELECT 1 FROM logs_auditoria a WHERE a.company_id = :company_id AND a.entity_type = q.aggregate_type AND a.entity_id = q.aggregate_id)
     LIMIT 1',
);
$statement->execute(["id" => $queueId, "company_id" => $user["company_id"]]);
$event = $statement->fetch();
if (!$event) {
    json_response(
        ["error" => "Evento não encontrado ou não disponível para retry."],
        404,
    );
}

$remoteUrl = trim((string) (getenv("SYNC_REMOTE_URL") ?: ""));
if ($remoteUrl === "") {
    $settings = $pdo->prepare(
        "SELECT sync_remote_url FROM configuracoes_empresa WHERE company_id = :company_id LIMIT 1",
    );
    $settings->execute(["company_id" => $user["company_id"]]);
    $remoteUrl = trim((string) ($settings->fetchColumn() ?: ""));
}
if ($remoteUrl === "") {
    json_response(
        [
            "data" => [
                "id" => (int) $event["id"],
                "status" => $event["status"],
                "processed" => false,
                "reason" => "SYNC_REMOTE_URL não configurada",
            ],
        ],
        202,
    );
}

$updateProcessing = $pdo->prepare(
    "UPDATE fila_sincronizacao SET status = 'PROCESSANDO', attempts = attempts + 1 WHERE id = :id AND status IN ('PENDENTE', 'ERRO') AND (available_at IS NULL OR available_at <= NOW())",
);
$updateProcessing->execute(["id" => $queueId]);
if ($updateProcessing->rowCount() !== 1) {
    json_response(["error" => "Evento já reservado ou aguardando o próximo horário de tentativa."], 409);
}
$requestBody = json_encode(
    [
        "event_uuid" => $event["event_uuid"],
        "aggregate_type" => $event["aggregate_type"],
        "aggregate_id" => (int) $event["aggregate_id"],
        "payload" => json_decode($event["payload"], true),
    ],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
);
$context = stream_context_create([
    "http" => [
        "method" => "POST",
        "header" => "Content-Type: application/json\r\n" .
            (trim((string) (getenv("SYNC_REMOTE_TOKEN") ?: "")) !== ""
                ? "Authorization: Bearer " . trim((string) getenv("SYNC_REMOTE_TOKEN")) . "\r\n"
                : ""),
        "content" => $requestBody,
        "timeout" => 5,
        "ignore_errors" => true,
    ],
]);
$response = @file_get_contents($remoteUrl, false, $context);
$responseHeaders = get_defined_vars()["http_response_header"] ?? [];
$success =
    $response !== false &&
    isset($responseHeaders[0]) &&
    preg_match("/\s2\d\d\s/", $responseHeaders[0]) === 1;

if ($success) {
    $done = $pdo->prepare(
        "UPDATE fila_sincronizacao SET status = 'ENVIADO', last_error = NULL WHERE id = :id",
    );
    $done->execute(["id" => $queueId]);
    json_response([
        "data" => [
            "id" => (int) $queueId,
            "status" => "ENVIADO",
            "processed" => true,
        ],
    ]);
}

$error = "Falha ao enviar para o endpoint remoto.";
$failed = $pdo->prepare(
    "UPDATE fila_sincronizacao SET status = 'ERRO', last_error = :last_error, available_at = DATE_ADD(NOW(), INTERVAL LEAST(attempts * 5, 300) SECOND) WHERE id = :id",
);
$failed->execute(["id" => $queueId, "last_error" => $error]);
json_response(
    ["error" => $error, "data" => ["id" => (int) $queueId, "status" => "ERRO"]],
    502,
);
