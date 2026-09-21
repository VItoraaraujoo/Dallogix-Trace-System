<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["POST"]);
$payload = ler_json_da_requisicao();
$code = strtoupper(trim((string) ($payload["activation_code"] ?? "")));
$installationToken = strtolower(trim((string) ($payload["installation_token"] ?? "")));
$hasInstallationToken = $installationToken !== "";
$normalized = str_replace("-", "", $code);
verificar_taxa_de_ativacao($code);
if (!preg_match('/^TRC-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/', $code)) {
    responder_json([
        "error" => "Código de ativação incorreto.",
        "error_code" => "ACTIVATION_CODE_INVALID",
    ], 422);
}
if ($hasInstallationToken && !credencial_instalacao_valida($installationToken)) {
    responder_json([
        "error" => "A instalação precisa apresentar uma credencial aleatória de 256 bits.",
        "error_code" => "INSTALLATION_TOKEN_INVALID",
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

if ($hasInstallationToken) {
    $usuarioAtivador = exigir_perfil(["ADMIN_EMPRESA"]);
    exigir_csrf();
    if ((int) ($usuarioAtivador["company_id"] ?? 0) !== (int) $empresa["id"]) {
        responder_json([
            "error" => "O administrador autenticado pertence a outra empresa.",
            "error_code" => "ACTIVATION_COMPANY_MISMATCH",
        ], 403);
    }
    $updateToken = obter_conexao_banco()->prepare(
        "UPDATE empresas SET installation_token_hash = :token_hash WHERE id = :id",
    );
    $updateToken->execute([
        "token_hash" => hash("sha256", $installationToken),
        "id" => $empresa["id"],
    ]);
}

responder_json([
    "data" => [
        "company_id" => (int) $empresa["id"],
        "name" => $empresa["name"],
        "login_domain" => $empresa["login_domain"],
        "active" => true,
    ],
]);
