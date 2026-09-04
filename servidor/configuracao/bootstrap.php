<?php

declare(strict_types=1);

$configuredTimezone = trim((string) (getenv("TZ") ?: "America/Sao_Paulo"));
if ($configuredTimezone !== "") {
    date_default_timezone_set($configuredTimezone);
}

header("Content-Type: application/json; charset=utf-8");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("Referrer-Policy: no-referrer");

session_name("dallogix_trace_session");
$sessionOptions = [
    "use_strict_mode" => 1,
    "use_only_cookies" => 1,
];
foreach ($sessionOptions as $option => $value) {
    ini_set("session.{$option}", (string) $value);
}
$isSecureSession =
    (getenv("APP_ENV") ?: "local") === "production" ||
    filter_var(getenv("SESSION_SECURE") ?: "false", FILTER_VALIDATE_BOOLEAN);
session_set_cookie_params([
    "httponly" => true,
    "samesite" => "Strict",
    "secure" => $isSecureSession,
]);
session_start();

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}

function db(): PDO
{
    static $connection;
    if ($connection instanceof PDO) {
        return $connection;
    }
    $host = getenv("DB_HOST") ?: "mysql";
    $name = getenv("DB_NAME") ?: "trace_local";
    $user = getenv("DB_USER") ?: "trace";
    $password = getenv("DB_PASSWORD") ?: "change-me-local";
    if (
        (getenv("APP_ENV") ?: "local") === "production" &&
        in_array($password, ["", "change-me-local", "change-me-root"], true)
    ) {
        throw new RuntimeException("DB_PASSWORD de produção não configurado.");
    }
    $connection = new PDO(
        "mysql:host={$host};dbname={$name};charset=utf8mb4",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ],
    );
    $connection->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    return $connection;
}

function request_json(): array
{
    $payload = json_decode(file_get_contents("php://input"), true);
    return is_array($payload) ? $payload : [];
}

function require_internal_token(string $environmentKey, string $developmentDefault): void
{
    $expected = trim((string) (getenv($environmentKey) ?: ""));
    if (
        (getenv("APP_ENV") ?: "local") === "production" &&
        ($expected === "" || $expected === $developmentDefault)
    ) {
        json_response(["error" => "Token interno não configurado."], 503);
    }
    $provided = trim((string) ($_SERVER["HTTP_X_INTERNAL_TOKEN"] ?? ""));
    if ($expected === "" || !hash_equals($expected, $provided)) {
        json_response(["error" => "Token interno inválido."], 401);
    }
}

function require_active_license(PDO $pdo, int $companyId): array
{
    $statement = $pdo->prepare(
        "SELECT id, status, blocked_reason
         FROM licencas WHERE company_id = :company_id ORDER BY id DESC LIMIT 1",
    );
    $statement->execute(["company_id" => $companyId]);
    $license = $statement->fetch();
    if (!$license) {
        json_response(["error" => "Empresa sem licença configurada."], 402);
    }
    if ($license["status"] !== "ATIVA") {
        json_response(
            [
                "error" => "Licença da empresa bloqueada.",
                "license_status" => $license["status"],
                "blocked_reason" => $license["blocked_reason"],
            ],
            402,
        );
    }
    return $license;
}

function csrf_token(): string
{
    if (empty($_SESSION["csrf_token"])) {
        $_SESSION["csrf_token"] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION["csrf_token"];
}

function require_csrf(): void
{
    if (strtolower(trim((string) (getenv("APP_ENV") ?: ""))) === "local") {
        return;
    }
    $provided = (string) ($_SERVER["HTTP_X_CSRF_TOKEN"] ?? "");
    if ($provided === "" || !hash_equals(csrf_token(), $provided)) {
        json_response(["error" => "Token CSRF inválido ou ausente."], 419);
    }
}

function enforce_login_rate_limit(string $identity): void
{
    if (strtolower(trim((string) (getenv("APP_ENV") ?: ""))) === "local") {
        return;
    }
    $key = hash(
        "sha256",
        ($_SERVER["REMOTE_ADDR"] ?? "unknown") . "|" . strtolower($identity),
    );
    $file = sys_get_temp_dir() . "/dallogix-login-" . $key . ".json";
    $handle = fopen($file, "c+");
    if ($handle === false) {
        json_response(
            ["error" => "Não foi possível validar o limite de tentativas."],
            503,
        );
    }
    flock($handle, LOCK_EX);
    $content = stream_get_contents($handle);
    $attempts = json_decode($content ?: "[]", true);
    if (!is_array($attempts)) {
        $attempts = [];
    }
    $now = time();
    $attempts = array_values(
        array_filter(
            $attempts,
            static fn($timestamp) => is_int($timestamp) &&
                $timestamp > $now - 60,
        ),
    );
    if (count($attempts) >= 10) {
        flock($handle, LOCK_UN);
        fclose($handle);
        json_response(
            ["error" => "Muitas tentativas. Aguarde um minuto."],
            429,
        );
    }
    $attempts[] = $now;
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($attempts));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
}

function session_user(): ?array
{
    return isset($_SESSION["user"]) && is_array($_SESSION["user"])
        ? $_SESSION["user"]
        : null;
}

function require_session_user(): array
{
    $user = session_user();
    if ($user === null) {
        json_response(["error" => "Autenticação necessária."], 401);
    }
    $statement = db()->prepare(
        "SELECT id, company_id, name, email, role, active FROM usuarios WHERE id = :id LIMIT 1",
    );
    $statement->execute(["id" => (int) ($user["id"] ?? 0)]);
    $current = $statement->fetch();
    if (!$current || !(bool) $current["active"]) {
        $_SESSION = [];
        session_destroy();
        json_response(["error" => "Sessão expirada ou acesso desativado."], 401);
    }
    $currentUser = public_user($current);
    $_SESSION["user"] = $currentUser;
    return $currentUser;
}

function require_role(array $allowedRoles): array
{
    $user = require_session_user();
    if (!in_array($user["role"], $allowedRoles, true)) {
        json_response(["error" => "Perfil sem permissão para esta ação."], 403);
    }
    return $user;
}

function public_user(array $user): array
{
    return [
        "id" => (int) $user["id"],
        "name" => $user["name"],
        "email" => $user["email"],
        "role" => $user["role"],
        "company_id" =>
        $user["company_id"] === null ? null : (int) $user["company_id"],
    ];
}

function record_operational_event(
    PDO $connection,
    array $user,
    string $action,
    string $entityType,
    int $entityId,
    array $payload = [],
): void {
    $metadata =
        json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        ) ?:
        "{}";
    try {
        $audit = $connection->prepare(
            "INSERT INTO logs_auditoria (company_id, user_id, action, entity_type, entity_id, metadata) VALUES (:company_id, :user_id, :action, :entity_type, :entity_id, :metadata)",
        );
        $audit->execute([
            "company_id" => $user["company_id"],
            "user_id" => $user["id"],
            "action" => $action,
            "entity_type" => $entityType,
            "entity_id" => $entityId,
            "metadata" => $metadata,
        ]);

        $eventUuid = sprintf(
            "%s-%s-%s-%s-%s",
            bin2hex(random_bytes(4)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(6)),
        );
        $syncPayload =
            json_encode(
                [
                    "action" => $action,
                    "entity_type" => $entityType,
                    "entity_id" => $entityId,
                    "data" => $payload,
                ],
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
            ) ?:
            "{}";
        $queue = $connection->prepare(
            "INSERT INTO fila_sincronizacao (event_uuid, aggregate_type, aggregate_id, payload) VALUES (:event_uuid, :aggregate_type, :aggregate_id, :payload)",
        );
        $queue->execute([
            "event_uuid" => $eventUuid,
            "aggregate_type" => $entityType,
            "aggregate_id" => $entityId,
            "payload" => $syncPayload,
        ]);
    } catch (Throwable $exception) {
        error_log(
            "Operational event could not be recorded: " .
                $exception->getMessage(),
        );
    }
}

/** Registra somente falhas inesperadas; campos sensíveis nunca entram no contexto. */
function registrar_log_erro(Throwable $exception, string $origem = "api"): void
{
    $user = session_user();
    $message = mb_substr(trim($exception->getMessage()) ?: "Falha inesperada.", 0, 1000);
    error_log("Dallogix Trace [{$origem}]: {$message}");
    try {
        $context = json_encode([
            "tipo" => get_class($exception),
            "arquivo" => basename($exception->getFile()),
            "linha" => $exception->getLine(),
            "metodo" => $_SERVER["REQUEST_METHOD"] ?? "CLI",
            "rota" => strtok($_SERVER["REQUEST_URI"] ?? "", "?"),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: "{}";
        $statement = db()->prepare(
            "INSERT INTO logs_erros (company_id, user_id, origem, mensagem, contexto) VALUES (:company_id, :user_id, :origem, :mensagem, :contexto)",
        );
        $statement->execute([
            "company_id" => $user["company_id"] ?? null,
            "user_id" => $user["id"] ?? null,
            "origem" => mb_substr($origem, 0, 120),
            "mensagem" => $message,
            "contexto" => $context,
        ]);
    } catch (Throwable $ignored) {
        error_log("Dallogix Trace: não foi possível persistir o log de erro.");
    }
}

set_exception_handler(static function (Throwable $exception): void {
    registrar_log_erro($exception, "erro_nao_tratado");
    if (!headers_sent()) {
        json_response(["error" => "Ocorreu um erro inesperado. Consulte os logs do sistema."], 500);
    }
});
