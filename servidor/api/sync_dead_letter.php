<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["GET", "PATCH"]);
$usuario = exigir_sessao_usuario();
if (!in_array($usuario["role"], ["ADMIN_DALLOGIX", "ADMIN_EMPRESA", "SUPERVISOR"], true)) {
    responder_json(["error" => "Perfil sem permissão para consultar a fila morta."], 403);
}

$pdo = obter_conexao_banco();
$companyId = filter_var($_GET["company_id"] ?? null, FILTER_VALIDATE_INT);
if ($usuario["role"] !== "ADMIN_DALLOGIX") {
    $companyId = (int) $usuario["company_id"];
}

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $where = ["resolved_at IS NULL"];
    $params = [];
    if ($companyId !== false && $companyId !== null && (int) $companyId > 0) {
        $where[] = "company_id = :company_id";
        $params["company_id"] = (int) $companyId;
    }
    $statement = $pdo->prepare(
        "SELECT id, original_event_id, company_id, event_uuid, event_type, aggregate_id,
                last_error, failed_attempts, moved_at
         FROM sync_dead_letter_queue
         WHERE " . implode(" AND ", $where) . "
         ORDER BY moved_at DESC, id DESC LIMIT 100",
    );
    $statement->execute($params);
    responder_json(["data" => $statement->fetchAll()]);
}

require_csrf();
$id = filter_var($_GET["id"] ?? null, FILTER_VALIDATE_INT);
$note = trim((string) ($_POST["resolution_note"] ?? ""));
$payload = ler_json_da_requisicao();
$id = $id ?: filter_var($payload["id"] ?? null, FILTER_VALIDATE_INT);
$note = $note !== "" ? $note : trim((string) ($payload["resolution_note"] ?? ""));
if (!$id || mb_strlen($note) > 1000) {
    responder_json(["error" => "Evento e observação de resolução são obrigatórios."], 422);
}

$conditions = ["id = :id", "resolved_at IS NULL"];
$params = ["id" => (int) $id, "resolved_by" => (int) $usuario["id"], "resolution_note" => $note];
if ($companyId !== false && $companyId !== null && (int) $companyId > 0) {
    $conditions[] = "company_id = :company_id";
    $params["company_id"] = (int) $companyId;
}
$update = $pdo->prepare(
    "UPDATE sync_dead_letter_queue
     SET resolved_at = NOW(), resolved_by = :resolved_by, resolution_note = :resolution_note
     WHERE " . implode(" AND ", $conditions),
);
$update->execute($params);
if ($update->rowCount() !== 1) {
    responder_json(["error" => "Evento não encontrado ou já resolvido."], 404);
}
responder_json(["data" => ["id" => (int) $id, "resolved" => true]]);
