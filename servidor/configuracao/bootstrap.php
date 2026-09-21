<?php

declare(strict_types=1);

function ambiente_atual(): string
{
    return strtolower(trim((string) (getenv("APP_ENV") ?: "local")));
}

function trace_e_instalacao_local(): bool
{
    $modo = strtolower(trim((string) (getenv("TRACE_INSTALLATION_MODE") ?: "")));
    if ($modo === "local" || $modo === "industrial") {
        return true;
    }
    if ($modo === "central" || $modo === "remoto" || $modo === "server") {
        return false;
    }
    return ambiente_atual() !== "production";
}

function metadados_release(): array
{
    $release = [
        "version" => trim((string) (getenv("TRACE_VERSION") ?: "development")),
        "commit" => trim((string) (getenv("TRACE_COMMIT") ?: "unknown")),
    ];
    $releaseFile = dirname(__DIR__) . "/.release.json";
    if (!is_file($releaseFile) || !is_readable($releaseFile)) {
        return $release;
    }
    $decoded = json_decode((string) file_get_contents($releaseFile), true);
    if (!is_array($decoded)) {
        return $release;
    }
    foreach (["version", "commit"] as $field) {
        $value = trim((string) ($decoded[$field] ?? ""));
        if ($value !== "" && strlen($value) <= 128) {
            $release[$field] = $value;
        }
    }
    return $release;
}

function limite_sinal_clp_segundos(): int
{
    $configurado = filter_var(
        getenv("CLP_SIGNAL_LIMIT_SECONDS") ?: 3,
        FILTER_VALIDATE_INT,
    );
    return max(1, min(60, $configurado === false ? 3 : (int) $configurado));
}

/**
 * Placas são exibidas em várias telas e também atravessam a sincronização.
 * Mantenha o valor em um conjunto simples de caracteres antes de persistir;
 * a interface continua fazendo escape como defesa adicional.
 */
function placa_caminhao_valida(string $placa): bool
{
    return $placa !== "" && mb_strlen($placa) <= 20 && preg_match(
        '/^[A-Z0-9À-ÿ _.,\/-]+$/u',
        $placa,
    ) === 1;
}

function nome_empresa_valido(string $nome): bool
{
    return $nome !== "" && mb_strlen($nome) <= 160 && preg_match(
        '/^[^\x00-\x1F\x7F]+$/u',
        $nome,
    ) === 1;
}

$configuredTimezone = trim((string) (getenv("TZ") ?: "America/Sao_Paulo"));
if ($configuredTimezone !== "") {
    date_default_timezone_set($configuredTimezone);
}

header("Content-Type: application/json; charset=utf-8");
header("X-Content-Type-Options: nosniff");
header("X-Frame-Options: DENY");
header("Referrer-Policy: no-referrer");
header("Cross-Origin-Resource-Policy: same-origin");
header("Cross-Origin-Opener-Policy: same-origin");

// Converte avisos do PHP em exceções para que nenhuma resposta de API receba
// HTML misturado ao JSON esperado pelo navegador.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

if (function_exists("ini_set")) {
    ini_set("session.use_strict_mode", "1");
    ini_set("session.cookie_httponly", "1");
    ini_set("session.cookie_samesite", "Strict");
}

session_name("dallogix_trace_session");
$appUrl = strtolower(trim((string) (getenv("APP_URL") ?: "")));
$isSecureSession =
    str_starts_with($appUrl, "https://") ||
    ambiente_atual() === "production" ||
    filter_var(getenv("SESSION_SECURE") ?: "false", FILTER_VALIDATE_BOOLEAN);
session_set_cookie_params([
    "lifetime" => 0,
    "path" => "/",
    "domain" => "",
    "secure" => $isSecureSession,
    "httponly" => true,
    "samesite" => "Strict",
]);
session_start();

$sessionIdleTimeout = max(300, (int) (getenv("SESSION_IDLE_TIMEOUT") ?: 1800));
if (isset($_SESSION["last_activity"]) && time() - (int) $_SESSION["last_activity"] > $sessionIdleTimeout) {
    $_SESSION = [];
    session_destroy();
    session_start();
}
$_SESSION["last_activity"] = time();

function responder_json(array $dados, int $status = 200): never
{
    header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
    header("Pragma: no-cache");
    http_response_code($status);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}

/** @deprecated Use responder_json() in new endpoints. */
function json_response(array $payload, int $status = 200): never
{
    responder_json($payload, $status);
}

function obter_conexao_banco(): PDO
{
    static $connection;
    if ($connection instanceof PDO) {
        return $connection;
    }

    $host = getenv("DB_HOST") ?: "mysql";
    $name = getenv("DB_NAME") ?: "trace_local";
    $user = getenv("DB_USER") ?: "trace";
    $password = trim((string) getenv("DB_PASSWORD"));

    if ($password === "") {
        throw new RuntimeException("DB_PASSWORD não configurado.");
    }

    if (
        ambiente_atual() === "production" &&
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
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    );
    $connection->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
    return $connection;
}

/** @deprecated Use obter_conexao_banco() in new endpoints. */
function db(): PDO
{
    return obter_conexao_banco();
}

function exigir_metodo_http(array $metodosPermitidos): void
{
    $metodoAtual = strtoupper((string) ($_SERVER["REQUEST_METHOD"] ?? "GET"));
    if (!in_array($metodoAtual, array_map('strtoupper', $metodosPermitidos), true)) {
        responder_json(["error" => "Método de requisição não permitido."], 405);
    }
}

function ler_json_da_requisicao(bool $exigirTipoJson = true): array
{
    $metodo = strtoupper((string) ($_SERVER["REQUEST_METHOD"] ?? "GET"));
    if (in_array($metodo, ["GET", "HEAD"], true)) {
        return [];
    }

    if ($exigirTipoJson) {
        $contentType = strtolower((string) ($_SERVER["CONTENT_TYPE"] ?? ""));
        if ($contentType !== "" && !str_contains($contentType, "application/json")) {
            responder_json(["error" => "Content-Type inválido. Envie JSON."], 415);
        }
    }

    $rawBody = file_get_contents("php://input");
    if ($rawBody === false || trim($rawBody) === "") {
        responder_json(["error" => "Corpo da requisição inválido."], 400);
    }

    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        responder_json(["error" => "JSON da requisição inválido."], 400);
    }

    return $payload;
}

/** @deprecated Use ler_json_da_requisicao() in new endpoints. */
function request_json(): array
{
    return ler_json_da_requisicao();
}

/** @return array{id:int, company_id:int, equipment_id:int, device_code:string, device_type:string} */
function require_device_token(array $allowedDeviceTypes = []): array
{
    $provided = trim((string) ($_SERVER["HTTP_X_DEVICE_TOKEN"] ?? ""));
    if ($provided === "") {
        responder_json(["error" => "Credencial do dispositivo ausente."], 401);
    }

    $statement = obter_conexao_banco()->query(
        "SELECT id, company_id, equipment_id, device_code, device_type, token_hash
         FROM dispositivos WHERE active = 1",
    );
    $device = null;
    foreach ($statement->fetchAll() as $candidate) {
        if (password_verify($provided, (string) $candidate["token_hash"])) {
            $device = $candidate;
            break;
        }
    }
    if ($device === null) {
        responder_json(["error" => "Credencial do dispositivo inválida."], 401);
    }
    if ($allowedDeviceTypes !== [] && !in_array($device["device_type"], $allowedDeviceTypes, true)) {
        responder_json(["error" => "Dispositivo sem permissão para esta operação."], 403);
    }

    $touch = obter_conexao_banco()->prepare(
        "UPDATE dispositivos SET last_seen_at = NOW() WHERE id = :id AND active = 1",
    );
    $touch->execute(["id" => $device["id"]]);

    return [
        "id" => (int) $device["id"],
        "company_id" => (int) $device["company_id"],
        "equipment_id" => (int) $device["equipment_id"],
        "device_code" => (string) $device["device_code"],
        "device_type" => (string) $device["device_type"],
    ];
}

function token_bearer_instalacao(): string
{
    $authorization = trim((string) ($_SERVER["HTTP_AUTHORIZATION"] ?? ""));
    if (preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
        return trim((string) $matches[1]);
    }
    return trim((string) ($_SERVER["HTTP_X_INSTALLATION_TOKEN"] ?? ""));
}

/** @return array{id:int,name:string,login_domain:string,license_status:string,license_reason:?string} */
function exigir_instalacao_remota(): array
{
    $token = token_bearer_instalacao();
    if ($token === "" || strlen($token) > 128) {
        responder_json(["error" => "Credencial da instalação ausente ou inválida."], 401);
    }

    $normalized = str_replace("-", "", strtoupper($token));
    $pdo = obter_conexao_banco();
    $statement = $pdo->prepare(
        "SELECT id, name, login_domain
         FROM empresas
         WHERE archived_at IS NULL AND activation_code_hash = :code_hash
         LIMIT 1",
    );
    $statement->execute(["code_hash" => hash("sha256", $normalized)]);
    $company = $statement->fetch();
    if (!$company) {
        responder_json(["error" => "Credencial da instalação inválida."], 401);
    }

    // O código identifica a instalação, mas a licença decide se ela pode
    // continuar sincronizando. A mesma regra também é usada pelas rotas
    // operacionais autenticadas.
    $license = validar_licenca_ativa($pdo, (int) $company["id"]);

    return [
        "id" => (int) $company["id"],
        "name" => (string) $company["name"],
        "login_domain" => (string) $company["login_domain"],
        "license_status" => (string) $license["status"],
        "license_reason" => $license["blocked_reason"] !== null
            ? (string) $license["blocked_reason"]
            : null,
    ];
}

function validar_licenca_ativa(PDO $pdo, int $companyId): array
{
    $statement = $pdo->prepare(
        "SELECT id, status, blocked_reason
         FROM licencas
         WHERE company_id = :company_id
         ORDER BY id DESC
         LIMIT 1",
    );
    $statement->execute(["company_id" => $companyId]);
    $license = $statement->fetch();

    if (!$license) {
        responder_json([
            "error" => "Empresa sem licença configurada.",
            "error_code" => "LICENSE_INACTIVE",
            "license_status" => "SEM_LICENCA",
        ], 402);
    }

    if ($license["status"] !== "ATIVA") {
        responder_json(
            [
                "error" => "Licença da empresa bloqueada.",
                "error_code" => "LICENSE_INACTIVE",
                "license_status" => $license["status"],
                "blocked_reason" => $license["blocked_reason"],
            ],
            402,
        );
    }

    return $license;
}

function validar_licenca_local_se_ativada(PDO $pdo, int $companyId): void
{
    if (!trace_e_instalacao_local() || $companyId < 1) {
        return;
    }

    $installation = $pdo->query(
        "SELECT company_id FROM instalacoes_locais WHERE id = 1 LIMIT 1",
    )->fetchColumn();
    if ($installation === false || (int) $installation !== $companyId) {
        return;
    }

    validar_licenca_ativa($pdo, $companyId);
}

/** @deprecated Use validar_licenca_ativa() in new endpoints. */
function require_active_license(PDO $pdo, int $companyId): array
{
    return validar_licenca_ativa($pdo, $companyId);
}

function gerar_token_csrf(): string
{
    if (empty($_SESSION["csrf_token"])) {
        $_SESSION["csrf_token"] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION["csrf_token"];
}

/** @return array{code:string,hash:string,preview:string} */
function gerar_codigo_ativacao_empresa(): array
{
    $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    $part = static function () use ($alphabet): string {
        $value = "";
        for ($index = 0; $index < 4; $index++) {
            $value .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $value;
    };
    $code = "TRC-{$part()}-{$part()}";
    $normalized = str_replace("-", "", $code);
    return [
        "code" => $code,
        "hash" => hash("sha256", $normalized),
        "preview" => substr($normalized, -4),
    ];
}

function exigir_csrf(): void
{
    if (getenv("TRACE_TESTING_DISABLE_CSRF") === "1") {
        return;
    }

    $provided = (string) ($_SERVER["HTTP_X_CSRF_TOKEN"] ?? "");
    if ($provided === "" || !hash_equals(gerar_token_csrf(), $provided)) {
        responder_json(["error" => "Token CSRF inválido ou ausente."], 419);
    }
}

/** @deprecated Use exigir_csrf() in new endpoints. */
function require_csrf(): void
{
    exigir_csrf();
}

function hash_limite_login_conta(string $identidade): string
{
    return hash("sha256", strtolower(trim($identidade)));
}

function hash_limite_login_ip(): string
{
    $ip = trim((string) ($_SERVER["REMOTE_ADDR"] ?? ""));
    if (!filter_var($ip, FILTER_VALIDATE_IP)) {
        $ip = "unknown";
    }
    return hash("sha256", "ip|" . $ip);
}

function registrar_tentativa_limitada_de_login(
    PDO $connection,
    string $identityHash,
    int $maxAttempts,
): ?int {
    $ensure = $connection->prepare(
        "INSERT INTO limites_login (identity_hash, attempts, window_started_at, blocked_until, violation_count)
         VALUES (:identity_hash, 0, NOW(), NULL, 0)
         ON DUPLICATE KEY UPDATE identity_hash = VALUES(identity_hash)",
    );
    $ensure->execute(["identity_hash" => $identityHash]);

    $statement = $connection->prepare(
        "SELECT attempts, blocked_until, violation_count,
                TIMESTAMPDIFF(SECOND, window_started_at, NOW()) AS window_age_seconds,
                TIMESTAMPDIFF(SECOND, NOW(), blocked_until) AS remaining_block_seconds
         FROM limites_login WHERE identity_hash = :identity_hash LIMIT 1 FOR UPDATE",
    );
    $statement->execute(["identity_hash" => $identityHash]);
    $limit = $statement->fetch();
    if (!$limit) {
        throw new RuntimeException("Registro de limite de login não encontrado.");
    }

    $remaining = max(0, (int) ($limit["remaining_block_seconds"] ?? 0));
    if ($limit["blocked_until"] !== null && $remaining > 0) {
        return $remaining;
    }

    $resetWindow = (int) ($limit["window_age_seconds"] ?? 0) >= 60;
    $attempts = ($resetWindow ? 0 : (int) $limit["attempts"]) + 1;
    if ($attempts >= $maxAttempts) {
        $violations = (int) $limit["violation_count"] + 1;
        $blockSeconds = min(900, 60 * (2 ** min(4, $violations - 1)));
        $update = $connection->prepare(
            "UPDATE limites_login
             SET attempts = 0, window_started_at = NOW(),
                 blocked_until = DATE_ADD(NOW(), INTERVAL {$blockSeconds} SECOND),
                 violation_count = :violation_count
             WHERE identity_hash = :identity_hash",
        );
        $update->execute([
            "violation_count" => $violations,
            "identity_hash" => $identityHash,
        ]);
        return $blockSeconds;
    }

    $update = $connection->prepare(
        "UPDATE limites_login
         SET attempts = :attempts,
             window_started_at = IF(:reset_window = 1, NOW(), window_started_at),
             blocked_until = NULL
         WHERE identity_hash = :identity_hash",
    );
    $update->execute([
        "attempts" => $attempts,
        "reset_window" => $resetWindow ? 1 : 0,
        "identity_hash" => $identityHash,
    ]);
    return null;
}

function verificar_taxa_de_login(string $identidade): void
{
    if (getenv("TRACE_TESTING_DISABLE_LOGIN_RATE_LIMIT") === "1") {
        return;
    }

    $connection = obter_conexao_banco();
    try {
        $connection->beginTransaction();
        $retryAfter = null;
        foreach ([
            [hash_limite_login_ip(), 30],
            [hash_limite_login_conta($identidade), 10],
        ] as [$bucket, $maxAttempts]) {
            $retryAfter = registrar_tentativa_limitada_de_login(
                $connection,
                $bucket,
                $maxAttempts,
            );
            if ($retryAfter !== null) {
                break;
            }
        }
        $connection->commit();
        if ($retryAfter !== null) {
            header("Retry-After: {$retryAfter}");
            responder_json(["error" => "Muitas tentativas. Aguarde alguns minutos."], 429);
        }
    } catch (Throwable $exception) {
        if ($connection->inTransaction()) {
            $connection->rollBack();
        }
        throw $exception;
    }
}

function registrar_login_sucesso(string $identidade): void
{
    if (getenv("TRACE_TESTING_DISABLE_LOGIN_RATE_LIMIT") === "1") {
        return;
    }
    $statement = obter_conexao_banco()->prepare(
        "UPDATE limites_login
         SET attempts = 0, window_started_at = NOW(), blocked_until = NULL, violation_count = 0
         WHERE identity_hash = :identity_hash",
    );
    $statement->execute([
        "identity_hash" => hash_limite_login_conta($identidade),
    ]);
}

function dominio_base_login(): string
{
    $configurado = strtolower(trim((string) (getenv("LOGIN_EMAIL_BASE_DOMAIN") ?: "dallogix")));
    $base = preg_replace('/[^a-z0-9.-]+/', '-', $configurado) ?: "dallogix";
    $base = trim($base, ".-");
    return $base !== "" ? $base : "dallogix";
}

function slug_empresa(string $nome): string
{
    $ascii = function_exists("iconv")
        ? @iconv("UTF-8", "ASCII//TRANSLIT//IGNORE", $nome)
        : false;
    $origem = $ascii !== false && $ascii !== "" ? $ascii : $nome;
    $slug = strtolower((string) (preg_replace('/[^a-z0-9]+/i', '-', $origem) ?: ""));
    $slug = trim($slug, "-");
    return $slug !== "" ? $slug : "empresa";
}

function gerar_dominio_login_empresa(PDO $pdo, string $nome): string
{
    $prefixo = dominio_base_login() . ".";
    $slug = substr(slug_empresa($nome), 0, max(1, 120 - strlen($prefixo)));
    $base = $prefixo . $slug;
    $candidato = $base;
    $sufixo = 2;
    $consulta = $pdo->prepare(
        "SELECT id FROM empresas WHERE login_domain = :company_login_domain
         UNION ALL
         SELECT id FROM usuarios WHERE email LIKE CONCAT('%@', :user_login_domain) LIMIT 1",
    );

    while (true) {
        $consulta->execute([
            "company_login_domain" => $candidato,
            "user_login_domain" => $candidato,
        ]);
        if (!$consulta->fetch()) {
            return $candidato;
        }

        $textoSufixo = "-" . $sufixo;
        $candidato = substr($base, 0, max(1, 120 - strlen($textoSufixo))) . $textoSufixo;
        $sufixo++;
    }
}

function obter_usuario_sessao(): ?array
{
    return isset($_SESSION["user"]) && is_array($_SESSION["user"])
        ? $_SESSION["user"]
        : null;
}

function exigir_sessao_usuario(bool $permitirTrocaSenha = false): array
{
    $usuario = obter_usuario_sessao();
    if ($usuario === null) {
        responder_json(["error" => "Autenticação necessária."], 401);
    }
    $consulta = obter_conexao_banco()->prepare(
        "SELECT u.id, u.company_id, u.name, u.email, u.role, u.active, u.must_change_password, u.auth_version,
                e.login_domain AS company_login_domain
         FROM usuarios u
         LEFT JOIN empresas e ON e.id = u.company_id
         WHERE u.id = :id
           AND (u.company_id IS NULL OR e.archived_at IS NULL)
         LIMIT 1",
    );
    $consulta->execute(["id" => (int) ($usuario["id"] ?? 0)]);
    $usuarioAtual = $consulta->fetch();
    if (!$usuarioAtual || !(bool) $usuarioAtual["active"]) {
        $_SESSION = [];
        session_destroy();
        responder_json(["error" => "Sessão expirada ou acesso desativado."], 401);
    }
    $sessionAuthVersion = (int) ($_SESSION["auth_version"] ?? 0);
    if ($sessionAuthVersion > 0 && $sessionAuthVersion !== (int) $usuarioAtual["auth_version"]) {
        $_SESSION = [];
        session_destroy();
        responder_json(["error" => "A sessão foi encerrada porque as credenciais foram alteradas."], 401);
    }
    $usuarioPublico = usuario_publico($usuarioAtual);
    validar_licenca_local_se_ativada(
        obter_conexao_banco(),
        (int) ($usuarioPublico["company_id"] ?? 0),
    );
    $_SESSION["user"] = $usuarioPublico;
    $_SESSION["auth_version"] = (int) $usuarioAtual["auth_version"];
    $_SESSION["user_validated_at"] = time();
    return $usuarioPublico;
}

/** @deprecated Use exigir_sessao_usuario() in new endpoints. */
function require_session_user(): array
{
    return exigir_sessao_usuario();
}

function exigir_perfil(array $perfisPermitidos): array
{
    $usuario = exigir_sessao_usuario();
    if (!in_array($usuario["role"], $perfisPermitidos, true)) {
        responder_json(["error" => "Perfil sem permissão para esta ação."], 403);
    }
    return $usuario;
}

/** @deprecated Use exigir_perfil() in new endpoints. */
function require_role(array $allowedRoles): array
{
    return exigir_perfil($allowedRoles);
}

function usuario_publico(array $usuario): array
{
    return [
        "id" => (int) $usuario["id"],
        "name" => $usuario["name"],
        "email" => $usuario["email"],
        "role" => $usuario["role"],
        "company_id" => $usuario["company_id"] === null ? null : (int) $usuario["company_id"],
        "company_login_domain" => isset($usuario["company_login_domain"])
            ? (string) $usuario["company_login_domain"]
            : null,
        "must_change_password" => (bool) ($usuario["must_change_password"] ?? false),
    ];
}

function registrar_evento_operacional(
    PDO $conexao,
    array $usuario,
    string $acao,
    string $tipoEntidade,
    int $entidadeId,
    array $payload = [],
): void {
    // Um administrador da plataforma pode operar sobre uma empresa-alvo. A
    // empresa do ator continua sendo a fonte principal; no escopo Master, a
    // operação deve informar company_id no payload para manter a fila isolada.
    $companyId = filter_var(
        $usuario["company_id"] ?? $payload["company_id"] ?? null,
        FILTER_VALIDATE_INT,
    );
    $platformEvent = ($companyId === false || $companyId === null || (int) $companyId < 1)
        && ($usuario["role"] ?? "") === "ADMIN_DALLOGIX";
    if (!$platformEvent && ($companyId === false || $companyId === null || (int) $companyId < 1)) {
        throw new RuntimeException("Evento operacional sem empresa vinculada.");
    }

    $providedEventUuid = trim((string) ($payload["event_uuid"] ?? ""));
    $eventUuid = preg_match('/^[a-f0-9-]{16,80}$/i', $providedEventUuid)
        ? $providedEventUuid
        : sprintf(
            "%s-%s-%s-%s-%s",
            bin2hex(random_bytes(4)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(2)),
            bin2hex(random_bytes(6)),
        );

    $metadata = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
    );

    $auditoria = $conexao->prepare(
        "INSERT INTO logs_auditoria (event_uuid, company_id, user_id, action, entity_type, entity_id, metadata) VALUES (:event_uuid, :company_id, :user_id, :action, :entity_type, :entity_id, :metadata)",
    );
    $auditoria->execute([
        "event_uuid" => $eventUuid,
        "company_id" => $platformEvent ? null : (int) $companyId,
        "user_id" => $usuario["id"] ?? null,
        "action" => $acao,
        "entity_type" => $tipoEntidade,
        "entity_id" => $entidadeId,
        "metadata" => $metadata,
    ]);

    $payloadSincronizacao = json_encode(
        [
            "action" => $acao,
            "entity_type" => $tipoEntidade,
            "entity_id" => $entidadeId,
            "data" => $payload,
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
    );

    if ($platformEvent) {
        // Eventos do administrador da plataforma não pertencem a uma empresa
        // e, portanto, não entram na fila de sincronização multiempresa.
        return;
    }
    $fila = $conexao->prepare(
        "INSERT INTO fila_sincronizacao (company_id, event_uuid, aggregate_type, aggregate_id, payload) VALUES (:company_id, :event_uuid, :aggregate_type, :aggregate_id, :payload)",
    );
    $fila->execute([
        "company_id" => (int) $companyId,
        "event_uuid" => $eventUuid,
        "aggregate_type" => $tipoEntidade,
        "aggregate_id" => $entidadeId,
        "payload" => $payloadSincronizacao,
    ]);
}

function enfileirar_evento_sincronizacao(
    PDO $conexao,
    array $usuario,
    string $acao,
    string $tipoEntidade,
    int $entidadeId,
    array $payload = [],
): void {
    $companyId = filter_var(
        $usuario["company_id"] ?? $payload["company_id"] ?? null,
        FILTER_VALIDATE_INT,
    );
    if ($companyId === false || $companyId === null || (int) $companyId < 1) {
        throw new RuntimeException("Evento de sincronização sem empresa vinculada.");
    }

    $eventUuid = sprintf(
        "%s-%s-%s-%s-%s",
        bin2hex(random_bytes(4)),
        bin2hex(random_bytes(2)),
        bin2hex(random_bytes(2)),
        bin2hex(random_bytes(2)),
        bin2hex(random_bytes(6)),
    );
    $payloadSincronizacao = json_encode(
        [
            "action" => $acao,
            "entity_type" => $tipoEntidade,
            "entity_id" => $entidadeId,
            "data" => $payload,
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
    );
    $fila = $conexao->prepare(
        "INSERT INTO fila_sincronizacao (company_id, event_uuid, aggregate_type, aggregate_id, payload) VALUES (:company_id, :event_uuid, :aggregate_type, :aggregate_id, :payload)",
    );
    $fila->execute([
        "company_id" => (int) $companyId,
        "event_uuid" => $eventUuid,
        "aggregate_type" => $tipoEntidade,
        "aggregate_id" => $entidadeId,
        "payload" => $payloadSincronizacao,
    ]);
}

/** @deprecated Use registrar_evento_operacional() in new endpoints. */
function record_operational_event(
    PDO $connection,
    array $user,
    string $action,
    string $entityType,
    int $entityId,
    array $payload = [],
): void {
    registrar_evento_operacional($connection, $user, $action, $entityType, $entityId, $payload);
}

function registrar_log_erro(Throwable $exception, string $origem = "api"): void
{
    $usuario = obter_usuario_sessao();
    $mensagem = mb_substr(trim($exception->getMessage()) ?: "Falha inesperada.", 0, 1000);
    error_log("Dallogix Trace [{$origem}]: {$mensagem}");

    try {
        $contexto = json_encode(
            [
                "tipo" => get_class($exception),
                "arquivo" => basename($exception->getFile()),
                "linha" => $exception->getLine(),
                "metodo" => $_SERVER["REQUEST_METHOD"] ?? "CLI",
                "rota" => strtok($_SERVER["REQUEST_URI"] ?? "", "?"),
            ],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        );
        if ($contexto === false) {
            $contexto = "{}";
        }

        $statement = db()->prepare(
            "INSERT INTO logs_erros (company_id, user_id, origem, mensagem, contexto) VALUES (:company_id, :user_id, :origem, :mensagem, :contexto)",
        );
        $statement->execute([
            "company_id" => $usuario["company_id"] ?? null,
            "user_id" => $usuario["id"] ?? null,
            "origem" => mb_substr($origem, 0, 120),
            "mensagem" => $mensagem,
            "contexto" => $contexto,
        ]);
    } catch (Throwable $ignored) {
        error_log("Dallogix Trace: não foi possível persistir o log de erro.");
    }
}

set_exception_handler(static function (Throwable $exception): void {
    registrar_log_erro($exception, "erro_nao_tratado");
    if (!headers_sent()) {
        responder_json(["error" => "Ocorreu um erro inesperado. Consulte os logs do sistema."], 500);
    }
});
