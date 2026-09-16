<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";
require_once __DIR__ . "/../src/Aplicacao/ServicoMonitoramento.php";

use App\Aplicacao\ServicoMonitoramento;

exigir_metodo_http(["GET"]);
$usuario = exigir_sessao_usuario();
if ($usuario["company_id"] === null) {
    responder_json(["error" => "Usuário sem empresa vinculada."], 403);
}
$periodDays = filter_var($_GET["period_days"] ?? 30, FILTER_VALIDATE_INT);
if ($periodDays === false) {
    responder_json(["error" => "Período de monitoramento inválido."], 422);
}
$limiteSemSinal = limite_sinal_clp_segundos();
$snapshot = (new ServicoMonitoramento(obter_conexao_banco()))->snapshot(
    (int) $usuario["company_id"],
    (int) $periodDays,
    $limiteSemSinal,
);
responder_json(["data" => $snapshot]);
