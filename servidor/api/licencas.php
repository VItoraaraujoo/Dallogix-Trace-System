<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_role(["ADMIN_DALLOGIX"]);
$pdo = db();

$effectiveStatus = static function (array $license): string {
    if ($license["status"] !== "ATIVA") {
        return (string) $license["status"];
    }
    $today = new DateTimeImmutable("today");
    $due = new DateTimeImmutable((string) $license["due_at"]);
    $grace = $license["grace_until"]
        ? new DateTimeImmutable((string) $license["grace_until"])
        : null;
    return $due < $today && (!$grace || $grace < $today)
        ? "INADIMPLENTE"
        : "ATIVA";
};

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $statement = $pdo->query(
        "SELECT l.id, l.company_id, c.name AS company_name, l.plan_name,
                l.billing_period, l.status, l.due_at, l.grace_until,
                l.blocked_at, l.blocked_reason, l.created_at, l.updated_at
         FROM licenses l JOIN companies c ON c.id = l.company_id
         WHERE l.id = (SELECT latest.id FROM licenses latest
                       WHERE latest.company_id = l.company_id
                       ORDER BY latest.id DESC LIMIT 1)
         ORDER BY c.name",
    );
    $rows = array_map(static function (array $license) use ($effectiveStatus): array {
        $license["effective_status"] = $effectiveStatus($license);
        return $license;
    }, $statement->fetchAll());
    json_response(["data" => $rows]);
}

if ($_SERVER["REQUEST_METHOD"] !== "PUT") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();
$payload = request_json();
$companyId = filter_var($payload["company_id"] ?? null, FILTER_VALIDATE_INT);
$status = strtoupper(trim((string) ($payload["status"] ?? "")));
$dueAt = trim((string) ($payload["due_at"] ?? ""));
$graceUntil = trim((string) ($payload["grace_until"] ?? ""));
$reason = trim((string) ($payload["blocked_reason"] ?? ""));
$plan = trim((string) ($payload["plan_name"] ?? "Trace Mensal"));
if (!$companyId || !in_array($status, ["ATIVA", "INADIMPLENTE", "BLOQUEADA", "CANCELADA"], true)) {
    json_response(["error" => "Empresa e status de licença são obrigatórios."], 422);
}
$validDate = static function (string $value, string $label): ?string {
    if ($value === "") return null;
    $date = DateTimeImmutable::createFromFormat("Y-m-d", $value);
    if (!$date || $date->format("Y-m-d") !== $value) {
        json_response(["error" => "{$label} inválida."], 422);
    }
    return $value;
};
$dueAt = $validDate($dueAt, "Data de vencimento");
if ($dueAt === null) {
    json_response(["error" => "Data de vencimento é obrigatória."], 422);
}
$graceUntil = $validDate($graceUntil, "Data de tolerância");
if ($plan === "" || mb_strlen($plan) > 100 || mb_strlen($reason) > 255) {
    json_response(["error" => "Dados da licença inválidos."], 422);
}
$company = $pdo->prepare("SELECT id FROM companies WHERE id = :id LIMIT 1");
$company->execute(["id" => $companyId]);
if (!$company->fetch()) json_response(["error" => "Empresa não encontrada."], 404);

$statement = $pdo->prepare(
    "INSERT INTO licenses (company_id, plan_name, billing_period, status, due_at, grace_until, blocked_at, blocked_reason)
     VALUES (:company_id, :plan_name, 'MENSAL', :status, :due_at, :grace_until, :blocked_at, :reason)",
);
$statement->execute([
    "company_id" => $companyId,
    "plan_name" => $plan,
    "status" => $status,
    "due_at" => $dueAt,
    "grace_until" => $graceUntil,
    "blocked_at" => in_array($status, ["ATIVA", "CANCELADA"], true) ? null : date("Y-m-d H:i:s"),
    "reason" => $reason !== "" ? $reason : null,
]);
$id = (int) $pdo->lastInsertId();
record_operational_event($pdo, $user, "LICENCA_ATUALIZADA", "license", $id, [
    "company_id" => (int) $companyId,
    "status" => $status,
    "due_at" => $dueAt,
]);
json_response(["data" => ["id" => $id, "company_id" => (int) $companyId, "status" => $status]], 201);
