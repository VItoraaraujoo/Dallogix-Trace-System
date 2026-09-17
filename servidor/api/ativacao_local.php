<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["GET"]);
if (!trace_e_instalacao_local()) {
    responder_json(["data" => ["enabled" => false, "active" => false]]);
}
$statement = obter_conexao_banco()->query(
    "SELECT i.company_id, i.remote_company_id, i.company_name, i.login_domain, i.activated_at
     FROM instalacoes_locais i
     WHERE i.id = 1
     LIMIT 1",
);
$installation = $statement->fetch();

if (!$installation) {
    responder_json(["data" => ["enabled" => true, "active" => false]]);
}

responder_json([
    "data" => [
        "enabled" => true,
        "active" => true,
        "company_id" => (int) $installation["company_id"],
        "remote_company_id" => (int) $installation["remote_company_id"],
        "company_name" => $installation["company_name"],
        "login_domain" => $installation["login_domain"],
        "activated_at" => $installation["activated_at"],
    ],
]);
