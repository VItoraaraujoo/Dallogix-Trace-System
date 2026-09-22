<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();
if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    json_response(["error" => "Método não permitido."], 405);
}
if ($user["company_id"] === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}

$pdo = db();
$scope = "q.company_id = :company_id";
$params = ["company_id" => $user["company_id"]];
$counts = $pdo->prepare(
    "SELECT q.status, COUNT(*) AS total FROM fila_sincronizacao q WHERE {$scope} GROUP BY q.status",
);
$counts->execute($params);
$summary = ["PENDENTE" => 0, "PROCESSANDO" => 0, "ENVIADO" => 0, "ERRO" => 0];
foreach ($counts->fetchAll() as $row) {
    $summary[$row["status"]] = (int) $row["total"];
}

$recent = $pdo->prepare(
    "SELECT q.id, q.aggregate_type, q.aggregate_id, q.status, q.attempts, q.last_error, q.available_at, q.created_at FROM fila_sincronizacao q WHERE {$scope} AND q.status IN ('PENDENTE', 'ERRO') ORDER BY q.id DESC LIMIT 20",
);
$recent->execute($params);
$remoteUrl = trim((string) (getenv("SYNC_REMOTE_BATCH_URL") ?: ""));
if ($remoteUrl === "") {
    $remoteUrl = trim((string) (getenv("SYNC_REMOTE_URL") ?: ""));
}
if ($remoteUrl === "") {
    $settings = $pdo->prepare(
        "SELECT sync_remote_url FROM configuracoes_empresa WHERE company_id = :company_id LIMIT 1",
    );
    $settings->execute(["company_id" => $user["company_id"]]);
    $remoteUrl = trim((string) ($settings->fetchColumn() ?: ""));
}
$centralUrlConfigured = trim((string) (getenv("TRACE_CENTRAL_URL") ?: "")) !== "";
$installation = $pdo->prepare(
    "SELECT last_remote_sync_at, last_remote_sync_error
     FROM instalacoes_locais
     WHERE id = 1 AND company_id = :company_id LIMIT 1",
);
$installation->execute(["company_id" => $user["company_id"]]);
$installationStatus = $installation->fetch() ?: null;
$centralMode = !trace_e_instalacao_local();
$centralPcStatus = null;
if ($centralMode) {
    $centralPc = $pdo->prepare(
        "SELECT status, last_seen_at
         FROM status_pc_industrial
         WHERE company_id = :company_id LIMIT 1",
    );
    $centralPc->execute(["company_id" => $user["company_id"]]);
    $centralPcStatus = $centralPc->fetch() ?: null;
}
$installationRegistered = $installationStatus !== null || $centralPcStatus !== null;
$remoteConfigured = $centralMode
    ? true
    : $remoteUrl !== "" || ($centralUrlConfigured && $installationRegistered);
$lastSyncAt = $centralMode
    ? ($centralPcStatus["last_seen_at"] ?? null)
    : ($installationStatus["last_remote_sync_at"] ?? null);
$lastSyncError = $centralMode
    ? ""
    : trim((string) ($installationStatus["last_remote_sync_error"] ?? ""));
$lastSyncAgeSeconds = null;
if ($lastSyncAt !== null && trim((string) $lastSyncAt) !== "") {
    try {
        $lastSync = new DateTimeImmutable((string) $lastSyncAt, new DateTimeZone("UTC"));
        $lastSyncAgeSeconds = max(
            0,
            time() - $lastSync->getTimestamp(),
        );
    } catch (Throwable $exception) {
        $lastSyncAgeSeconds = null;
    }
}
$pcSignalLimitSeconds = max(5, min(300, (int) (getenv("HEALTH_DEVICE_STALE_SECONDS") ?: 30)));
$reportedPcStatus = strtoupper(trim((string) ($centralPcStatus["status"] ?? "")));
if ($reportedPcStatus === "ERRO") {
    $pcStatus = "ERRO";
} elseif ($lastSyncAgeSeconds !== null && $lastSyncAgeSeconds <= $pcSignalLimitSeconds && $lastSyncError === "") {
    $pcStatus = "ONLINE";
} elseif ($reportedPcStatus === "OFFLINE" || $lastSyncAt !== null) {
    $pcStatus = "OFFLINE";
} else {
    $pcStatus = "DESCONHECIDO";
}
$pcOnline = $pcStatus === "ONLINE";
$centralSync = [
    "configured" => $remoteConfigured,
    "central_url_configured" => $centralUrlConfigured,
    "installation_registered" => $installationRegistered,
    "pc_online" => $pcOnline,
    "pc_status" => $pcStatus,
    "last_sync_at" => $lastSyncAt,
    "last_sync_age_seconds" => $lastSyncAgeSeconds,
    "pc_signal_limit_seconds" => $pcSignalLimitSeconds,
    "last_error" => $lastSyncError !== "" ? $lastSyncError : null,
];

json_response([
    "data" => [
        "summary" => $summary,
        "recent" => $recent->fetchAll(),
        "remote_configured" => $remoteConfigured,
        "central_sync" => $centralSync,
        "checked_at" => date("c"),
    ],
]);
