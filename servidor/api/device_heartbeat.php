<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
require_internal_token("PLC_INTERNAL_TOKEN", "change-me-plc-token");

$payload = request_json();
$equipmentId = filter_var(
    $payload["equipment_id"] ?? null,
    FILTER_VALIDATE_INT,
);
$deviceType = strtoupper(trim((string) ($payload["device_type"] ?? "")));
$status = strtoupper(trim((string) ($payload["status"] ?? "ONLINE")));
if (
    !$equipmentId ||
    !in_array(
        $deviceType,
        ["CLP", "SCANNER", "SENSOR", "CAMERA", "SERVER"],
        true,
    ) ||
    !in_array($status, ["ONLINE", "OFFLINE", "ERRO"], true)
) {
    json_response(
        [
            "error" =>
                "equipment_id, device_type e status válidos são obrigatórios.",
        ],
        422,
    );
}
$pdo = db();
$exists = $pdo->prepare("SELECT id FROM equipments WHERE id = :id LIMIT 1");
$exists->execute(["id" => $equipmentId]);
if (!$exists->fetch()) {
    json_response(["error" => "Equipamento não encontrado."], 404);
}
$details = isset($payload["details"])
    ? json_encode(
        $payload["details"],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
    )
    : null;
$upsert = $pdo->prepare(
    "INSERT INTO device_status (equipment_id, device_type, status, last_seen_at, details) VALUES (:equipment_id, :device_type, :status, NOW(), :details) ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = VALUES(last_seen_at), details = VALUES(details)",
);
$upsert->execute([
    "equipment_id" => $equipmentId,
    "device_type" => $deviceType,
    "status" => $status,
    "details" => $details,
]);
json_response([
    "data" => [
        "equipment_id" => (int) $equipmentId,
        "device_type" => $deviceType,
        "status" => $status,
    ],
]);
