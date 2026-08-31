<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();
if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    json_response(["error" => "Método não permitido."], 405);
}
if ($user["company_id"] === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}

$loadingId = filter_var($_GET["carregamento_id"] ?? null, FILTER_VALIDATE_INT);
if (!$loadingId) {
    json_response(["error" => "carregamento_id é obrigatório."], 422);
}

$statement = db()
    ->prepare("SELECT id, command, status, requested_at, claimed_at, completed_at, response_message
    FROM plc_command_requests
    WHERE carregamento_id = :carregamento_id AND company_id = :company_id
    ORDER BY id DESC LIMIT 1");
$statement->execute([
    "carregamento_id" => $loadingId,
    "company_id" => $user["company_id"],
]);
$command = $statement->fetch();
json_response(["data" => $command ?: null]);
