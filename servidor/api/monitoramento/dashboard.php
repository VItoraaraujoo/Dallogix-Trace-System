<?php
declare(strict_types=1);

require_once __DIR__ . "/../../configuracao/bootstrap.php";

// Métricas do dashboard no padrão da referência TracePlatform:
// total de romaneios, operações finalizadas, ocorrências, taxa de divergência e tempo médio de operação.
$user = require_session_user();
if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    json_response(["error" => "Método não permitido."], 405);
}
if ($user["company_id"] === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}

$pdo = db();
$companyId = $user["company_id"];

$count = static function (string $sql, array $params) use ($pdo): int {
    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    return (int) ($statement->fetchColumn() ?: 0);
};

$totalRomaneios = $count(
    "SELECT COUNT(*) FROM romaneios WHERE company_id = :company_id",
    ["company_id" => $companyId],
);
$operacoesFinalizadas = $count(
    "SELECT COUNT(*) FROM romaneios WHERE company_id = :company_id AND status = 'FINALIZADO'",
    ["company_id" => $companyId],
);
$totalOcorrencias = $count(
    "SELECT COUNT(*) FROM ocorrencias WHERE company_id = :company_id",
    ["company_id" => $companyId],
);

// Divergência: romaneio finalizado cuja contagem de leituras válidas difere do programado
// ou que registrou ocorrências durante o carregamento.
$divergenciaStatement = $pdo->prepare(
    "WITH quantidades_planejadas AS (
            SELECT ri.romaneio_id, SUM(ri.planned_quantity) AS total_planejado
            FROM romaneio_itens ri
            GROUP BY ri.romaneio_id
        ), leituras_validas AS (
            SELECT c.romaneio_id, COUNT(*) AS total_validas
            FROM leituras l
            JOIN carregamentos c ON c.id = l.carregamento_id
            WHERE c.company_id = :company_id_leituras
              AND l.result = 'VALIDO'
            GROUP BY c.romaneio_id
        ), ocorrencias_carregamento AS (
            SELECT c.romaneio_id, COUNT(*) AS total_ocorrencias
            FROM ocorrencias o
            JOIN carregamentos c ON c.id = o.carregamento_id
            WHERE c.company_id = :company_id_ocorrencias
            GROUP BY c.romaneio_id
        )
        SELECT COUNT(*)
        FROM romaneios r
        LEFT JOIN quantidades_planejadas qp ON qp.romaneio_id = r.id
        LEFT JOIN leituras_validas lv ON lv.romaneio_id = r.id
        LEFT JOIN ocorrencias_carregamento oc ON oc.romaneio_id = r.id
        WHERE r.company_id = :company_id_romaneios
          AND r.status = 'FINALIZADO'
          AND (
              COALESCE(qp.total_planejado, 0) <> COALESCE(lv.total_validas, 0)
              OR COALESCE(oc.total_ocorrencias, 0) > 0
          )",
);
$divergenciaStatement->execute([
    "company_id_leituras" => $companyId,
    "company_id_ocorrencias" => $companyId,
    "company_id_romaneios" => $companyId,
]);
$divergentes = (int) ($divergenciaStatement->fetchColumn() ?: 0);
$taxaDivergencia =
    $operacoesFinalizadas > 0
        ? round(($divergentes / $operacoesFinalizadas) * 100, 1)
        : 0.0;

$mediaStatement = $pdo->prepare(
    'SELECT COALESCE(AVG(TIMESTAMPDIFF(MINUTE, started_at, finished_at)), 0) FROM carregamentos WHERE company_id = :company_id AND state = \'FINALIZADO\' AND started_at IS NOT NULL AND finished_at IS NOT NULL',
);
$mediaStatement->execute(["company_id" => $companyId]);
$tempoMedio = (int) round((float) ($mediaStatement->fetchColumn() ?: 0));

json_response([
    "data" => [
        "total_romaneios" => $totalRomaneios,
        "operacoes_finalizadas" => $operacoesFinalizadas,
        "total_ocorrencias" => $totalOcorrencias,
        "taxa_divergencia" => $taxaDivergencia,
        "tempo_medio_operacao" => $tempoMedio,
    ],
]);
