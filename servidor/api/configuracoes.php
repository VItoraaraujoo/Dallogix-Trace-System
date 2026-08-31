<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();
if ($user["company_id"] === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}
$pdo = db();

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $settings = $pdo->prepare(
        "SELECT gateway_public_ip, sync_remote_url, pdf_field_mapping, pdf_search_field, updated_at FROM company_settings WHERE company_id = :company_id LIMIT 1",
    );
    $settings->execute(["company_id" => $user["company_id"]]);
    $data = $settings->fetch() ?: [
        "gateway_public_ip" => null,
        "sync_remote_url" => null,
        "pdf_field_mapping" => null,
        "pdf_search_field" => "barcode",
        "updated_at" => null,
    ];
    if (is_string($data["pdf_field_mapping"])) {
        $data["pdf_field_mapping"] = json_decode(
            $data["pdf_field_mapping"],
            true,
        );
    }
    $equipment = $pdo->prepare(
        "SELECT id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol FROM equipments WHERE company_id = :company_id ORDER BY equipment_code",
    );
    $equipment->execute(["company_id" => $user["company_id"]]);
    json_response([
        "data" => ["settings" => $data, "dalas" => $equipment->fetchAll()],
    ]);
}

if ($_SERVER["REQUEST_METHOD"] !== "PUT") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();
if (!in_array($user["role"], ["ADMIN_DALLOGIX", "ADMIN_EMPRESA"], true)) {
    json_response(
        ["error" => "Perfil sem permissão para alterar configurações."],
        403,
    );
}

$payload = request_json();
$gatewayIp = trim((string) ($payload["gateway_public_ip"] ?? ""));
$syncUrl = trim((string) ($payload["sync_remote_url"] ?? ""));
$mapping = $payload["pdf_field_mapping"] ?? [];
$pdfSearchField = in_array(
    $payload["pdf_search_field"] ?? "barcode",
    ["barcode", "sku"],
    true,
)
    ? $payload["pdf_search_field"] ?? "barcode"
    : "barcode";
if ($gatewayIp !== "" && strlen($gatewayIp) > 255) {
    json_response(["error" => "IP ou DDNS do gateway inválido."], 422);
}
if (
    $syncUrl !== "" &&
    (!filter_var($syncUrl, FILTER_VALIDATE_URL) || strlen($syncUrl) > 500)
) {
    json_response(["error" => "URL de sincronização inválida."], 422);
}
if ($syncUrl !== "") {
    $scheme = strtolower((string) parse_url($syncUrl, PHP_URL_SCHEME));
    $allowedSchemes = (getenv("APP_ENV") ?: "local") === "production"
        ? ["https"]
        : ["http", "https"];
    if (!in_array($scheme, $allowedSchemes, true)) {
        json_response(["error" => "A sincronização deve usar HTTP/HTTPS válido."], 422);
    }
}
if (!is_array($mapping)) {
    json_response(["error" => "Mapeamento PDF inválido."], 422);
}

$upsert = $pdo->prepare(
    "INSERT INTO company_settings (company_id, gateway_public_ip, sync_remote_url, pdf_field_mapping, pdf_search_field, updated_by) VALUES (:company_id, :gateway_public_ip, :sync_remote_url, :pdf_field_mapping, :pdf_search_field, :updated_by) ON DUPLICATE KEY UPDATE gateway_public_ip = VALUES(gateway_public_ip), sync_remote_url = VALUES(sync_remote_url), pdf_field_mapping = VALUES(pdf_field_mapping), pdf_search_field = VALUES(pdf_search_field), updated_by = VALUES(updated_by)",
);
$upsert->execute([
    "company_id" => $user["company_id"],
    "gateway_public_ip" => $gatewayIp !== "" ? $gatewayIp : null,
    "sync_remote_url" => $syncUrl !== "" ? $syncUrl : null,
    "pdf_field_mapping" => json_encode(
        $mapping,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
    ),
    "pdf_search_field" => $pdfSearchField,
    "updated_by" => $user["id"],
]);
record_operational_event(
    $pdo,
    $user,
    "CONFIGURACAO_ATUALIZADA",
    "company_settings",
    (int) $user["company_id"],
    [
        "gateway_public_ip" => $gatewayIp,
        "sync_remote_url_configurada" => $syncUrl !== "",
        "pdf_fields" => array_keys($mapping),
        "pdf_search_field" => $pdfSearchField,
    ],
);
json_response(["data" => ["saved" => true]]);
