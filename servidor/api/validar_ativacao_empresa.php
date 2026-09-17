<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["POST"]);
$payload = ler_json_da_requisicao();
$code = strtoupper(trim((string) ($payload["activation_code"] ?? "")));
$normalized = str_replace("-", "", $code);
if (!preg_match('/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $code)) {
    responder_json(["error" => "Código de ativação inválido."], 422);
}

$statement = obter_conexao_banco()->prepare(
    "SELECT id, name, login_domain
     FROM empresas
     WHERE activation_code_hash = :code_hash
     LIMIT 1",
);
$statement->execute(["code_hash" => hash("sha256", $normalized)]);
$empresa = $statement->fetch();
if (!$empresa) {
    responder_json(["error" => "Código de ativação inválido."], 401);
}

responder_json([
    "data" => [
        "company_id" => (int) $empresa["id"],
        "name" => $empresa["name"],
        "login_domain" => $empresa["login_domain"],
        "active" => true,
    ],
]);
