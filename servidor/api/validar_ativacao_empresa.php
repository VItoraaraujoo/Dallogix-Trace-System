<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["POST"]);
$payload = ler_json_da_requisicao();
$code = strtoupper(trim((string) ($payload["activation_code"] ?? "")));
$normalized = str_replace("-", "", $code);
if (!preg_match('/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}$/', $code)) {
    responder_json([
        "error" => "Código de ativação incorreto.",
        "error_code" => "ACTIVATION_CODE_INVALID",
    ], 422);
}

$statement = obter_conexao_banco()->prepare(
    "SELECT empresas.id, empresas.name, empresas.login_domain,
            (SELECT l.status FROM licencas l WHERE l.company_id = empresas.id ORDER BY l.id DESC LIMIT 1) AS license_status
     FROM empresas
     WHERE activation_code_hash = :code_hash
       AND archived_at IS NULL
     LIMIT 1",
);
$statement->execute(["code_hash" => hash("sha256", $normalized)]);
$empresa = $statement->fetch();
if (!$empresa) {
    responder_json([
        "error" => "Código de ativação incorreto.",
        "error_code" => "ACTIVATION_CODE_INVALID",
    ], 401);
}
if (($empresa["license_status"] ?? "") !== "ATIVA") {
    responder_json([
        "error" => "Ative a licença da empresa antes de ativar o PC industrial.",
        "error_code" => "LICENSE_INACTIVE",
    ], 409);
}

responder_json([
    "data" => [
        "company_id" => (int) $empresa["id"],
        "name" => $empresa["name"],
        "login_domain" => $empresa["login_domain"],
        "active" => true,
    ],
]);
