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
session_write_close();

// Conexões curtas atravessam proxies e releases; o cliente reconecta ao término.
header("Content-Type: text/event-stream; charset=utf-8");
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Connection: keep-alive");
header("X-Accel-Buffering: no");
header("X-Trace-Stream: carregamento-v1");
while (ob_get_level() > 0) {
    ob_end_flush();
}

$service = new ServicoMonitoramento(obter_conexao_banco());
$companyId = (int) $usuario["company_id"];
$periodDays = filter_var($_GET["period_days"] ?? 30, FILTER_VALIDATE_INT);
$periodDays = $periodDays === false ? 30 : max(1, min(3650, (int) $periodDays));
$limit = limite_sinal_clp_segundos();
$previous = "";
$startedAt = microtime(true);

while (!connection_aborted() && microtime(true) - $startedAt < 25) {
    $payload = [
        "monitoring" => $service->snapshot($companyId, $periodDays, $limit),
        "active_loadings" => $service->activeLoadings($companyId),
        "sent_at" => gmdate("c"),
    ];
    $encoded = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false) {
        break;
    }
    if ($encoded !== $previous) {
        echo "event: carregamento\n";
        echo "data: {$encoded}\n\n";
        $previous = $encoded;
    } else {
        echo ": keep-alive\n\n";
    }
    if (function_exists("ob_flush")) {
        @ob_flush();
    }
    flush();
    sleep(1);
}
