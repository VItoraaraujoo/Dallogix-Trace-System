<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_role(["ADMIN_DALLOGIX", "ADMIN_EMPRESA"]);
if ($_SERVER["REQUEST_METHOD"] !== "GET") json_response(["error" => "Método não permitido."], 405);
$pdo = db();
$scope = $user["role"] === "ADMIN_DALLOGIX" ? "1=1" : "l.company_id = :company_id";
$params = $user["role"] === "ADMIN_DALLOGIX" ? [] : ["company_id" => $user["company_id"]];
$statusPcTableAvailable = (bool) $pdo->query(
    "SELECT 1 FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'status_pc_industrial'
     LIMIT 1",
)->fetchColumn();
$where = [$scope];
if ($statusPcTableAvailable) {
    $where[] = "NOT (l.mensagem LIKE :resolved_status_pc_error)";
    $params["resolved_status_pc_error"] = "%status_pc_industrial%doesn't exist%";
}
$query = $pdo->prepare("SELECT l.id, l.origem, l.mensagem, l.contexto, l.criado_em, e.name AS empresa, u.name AS usuario FROM logs_erros l LEFT JOIN empresas e ON e.id = l.company_id LEFT JOIN usuarios u ON u.id = l.user_id WHERE " . implode(" AND ", $where) . " ORDER BY l.id DESC LIMIT 100");
$query->execute($params);
json_response(["data" => $query->fetchAll()]);
