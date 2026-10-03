<?php

declare(strict_types=1);

require_once __DIR__ . "/observabilidade.php";

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
    // An omitted or unknown mode must never silently enable local-only flows.
    return false;
}

function trace_uuid_v4(): string
{
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
    $hex = bin2hex($bytes);
    return substr($hex, 0, 8) . "-"
        . substr($hex, 8, 4) . "-"
        . substr($hex, 12, 4) . "-"
        . substr($hex, 16, 4) . "-"
        . substr($hex, 20, 12);
}

function url_remota_segura(string $url): string
{
    $url = trim($url);
    if ($url === "" || preg_match('/[\x00-\x1F\x7F]/', $url) === 1) {
        return "";
    }

    $parts = parse_url($url);
    if (!is_array($parts) || strtolower((string) ($parts["scheme"] ?? "")) !== "https") {
        return "";
    }
    if (($parts["host"] ?? "") === "" || isset($parts["user"]) || isset($parts["pass"])) {
        return "";
    }
    if (isset($parts["query"]) || isset($parts["fragment"])) {
        return "";
    }
    if (isset($parts["port"]) && ((int) $parts["port"] < 1 || (int) $parts["port"] > 65535)) {
        return "";
    }

    $host = trim((string) $parts["host"], "[]");
    $publicIp = static function (string $ip): bool {
        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) !== false;
    };
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return $publicIp($host) ? rtrim($url, "/") : "";
    }
    if (preg_match('/\A(?=.{1,253}\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\z/i', $host) !== 1) {
        return "";
    }

    $records = dns_get_record($host, DNS_A | DNS_AAAA);
    if ($records === false || $records === []) {
        return "";
    }
    $resolvedIps = [];
    foreach ($records as $record) {
        $ip = (string) ($record["ip"] ?? $record["ipv6"] ?? "");
        if ($ip === "" || !$publicIp($ip)) {
            return "";
        }
        $resolvedIps[] = $ip;
    }

    // Reuse the validated DNS answers when opening the connection to prevent
    // a second, attacker-controlled resolution between validation and cURL.
    $GLOBALS["trace_remote_dns"] ??= [];
    $GLOBALS["trace_remote_dns"][strtolower($host)] = array_values(array_unique($resolvedIps));
    return rtrim($url, "/");
}

/** @return CurlHandle|false */
function curl_init_url_remota_segura(string $url)
{
    $safeUrl = url_remota_segura($url);
    if ($safeUrl === "") {
        return false;
    }
    $parts = parse_url($safeUrl);
    if (!is_array($parts)) {
        return false;
    }
    $host = strtolower(trim((string) ($parts["host"] ?? ""), "[]"));
    $handle = curl_init($safeUrl);
    if ($handle === false || filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return $handle;
    }

    $ips = $GLOBALS["trace_remote_dns"][$host] ?? [];
    if ($ips === []) {
        curl_close($handle);
        return false;
    }
    $addresses = array_map(
        static fn (string $ip): string => filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false
            ? "[{$ip}]"
            : $ip,
        $ips,
    );
    $port = (int) ($parts["port"] ?? 443);
    if (!curl_setopt($handle, CURLOPT_RESOLVE, ["{$host}:{$port}:" . implode(",", $addresses)])) {
        curl_close($handle);
        return false;
    }

    return $handle;
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
 * Confirma que o último sinal recebido representa uma leitura Modbus real
 * para o mesmo destino atualmente cadastrado. Uma conexão TCP aberta, por si
 * só, não confirma protocolo, unidade, função ou registrador.
 */
function heartbeat_modbus_valido(mixed $details, string $hostEsperado, int $portaEsperada): bool
{
    if (is_string($details)) {
        $details = json_decode($details, true);
    }
    if (!is_array($details)) {
        return false;
    }

    $funcao = filter_var($details["modbus_function"] ?? null, FILTER_VALIDATE_INT);
    $unidade = filter_var($details["modbus_unit_id"] ?? null, FILTER_VALIDATE_INT);
    $registrador = filter_var($details["diagnostic_register"] ?? null, FILTER_VALIDATE_INT);
    $porta = filter_var($details["plc_port"] ?? null, FILTER_VALIDATE_INT);

    return strtolower(trim((string) ($details["communication"] ?? ""))) === "modbus_tcp"
        && trim((string) ($details["plc_ip"] ?? "")) === trim($hostEsperado)
        && $porta !== false && (int) $porta === $portaEsperada
        && $unidade !== false && (int) $unidade >= 0 && (int) $unidade <= 255
        && $funcao !== false && in_array((int) $funcao, [1, 2, 3, 4], true)
        && $registrador !== false && (int) $registrador >= 0 && (int) $registrador <= 65535
        && array_key_exists("diagnostic_value", $details);
}

function limite_alerta_fim_produto_sacas(): int
{
    $configurado = filter_var(
        getenv("TRACE_END_PRODUCT_ALERT_THRESHOLD") ?: 5,
        FILTER_VALIDATE_INT,
    );
    return max(1, min(1000, $configurado === false ? 5 : (int) $configurado));
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
    if (in_array($severity, [E_DEPRECATED, E_USER_DEPRECATED], true)) {
        // Depreciações devem ser registradas pelo PHP sem transformar toda a
        // resposta JSON em 500 durante uma atualização de runtime.
        return false;
    }
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

function trace_id_aba_da_sessao(): string
{
    $tabId = strtolower(trim((string) ($_SERVER["HTTP_X_TRACE_TAB"] ?? "")));
    return preg_match('/\A[a-f0-9]{32}\z/', $tabId) === 1 ? $tabId : "default";
}

function &trace_contexto_sessao(): array
{
    $tabId = (string) ($GLOBALS["trace_tab_id"] ?? "default");
    if (!isset($_SESSION["_trace_tabs"][$tabId]) || !is_array($_SESSION["_trace_tabs"][$tabId])) {
        $_SESSION["_trace_tabs"][$tabId] = [];
    }
    return $_SESSION["_trace_tabs"][$tabId];
}

session_name("dallogix_trace_session");
$appUrl = strtolower(trim((string) (getenv("APP_URL") ?: "")));
$isSecureSession =
    str_starts_with($appUrl, "https://") ||
    !trace_e_instalacao_local() ||
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
$skipSession = defined("TRACE_SKIP_SESSION");
$sessionIdleTimeout = max(300, (int) (getenv("SESSION_IDLE_TIMEOUT") ?: 1800));
$sessionGcLifetime = max(
    $sessionIdleTimeout,
    (int) (getenv("SESSION_GC_MAXLIFETIME") ?: 86400),
);
if (function_exists("ini_set")) {
    ini_set("session.gc_maxlifetime", (string) $sessionGcLifetime);
}
$hasSessionCookie = isset($_COOKIE[session_name()]);
$startSession = !$skipSession && ($hasSessionCookie || defined("TRACE_START_SESSION"));
if ($startSession) {
    session_start();
    $traceTabId = trace_id_aba_da_sessao();
    $GLOBALS["trace_tab_id"] = $traceTabId;
    if (!isset($_SESSION["_trace_tabs"]) || !is_array($_SESSION["_trace_tabs"])) {
        // Move a pre-upgrade session into the first tab context without
        // changing its cookie or silently logging the operator out.
        $legacySession = $_SESSION;
        unset($legacySession["_trace_tabs"]);
        $_SESSION = ["_trace_tabs" => [$traceTabId => $legacySession]];
    } elseif (!isset($_SESSION["_trace_tabs"][$traceTabId]) || !is_array($_SESSION["_trace_tabs"][$traceTabId])) {
        $_SESSION["_trace_tabs"][$traceTabId] = [];
    }
    foreach ($_SESSION["_trace_tabs"] as $tabId => $context) {
        $contextIsArray = is_array($context);
        $role = strtoupper(trim((string) ($contextIsArray ? ($context["user"]["role"] ?? "") : "")));
        $isOperatorSession = in_array($role, ["USUARIO", "OPERADOR"], true);
        // O operador pode manter a tela de operação aberta durante todo o
        // carregamento. Administradores e supervisores continuam protegidos
        // pelo limite de inatividade configurado no ambiente.
        $expiredByInactivity = !$contextIsArray
            || !isset($context["last_activity"])
            || time() - (int) $context["last_activity"] > $sessionIdleTimeout;
        if (!$contextIsArray || (!$isOperatorSession && $expiredByInactivity)) {
            unset($_SESSION["_trace_tabs"][$tabId]);
        }
    }
    $sessionContext =& trace_contexto_sessao();
    $sessionContext["last_activity"] = time();
    unset($sessionContext);
}
trace_correlation_id();

function responder_json(array $dados, int $status = 200): never
{
    header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
    header("Pragma: no-cache");
    http_response_code($status);
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit();
}

function encerrar_sessao_atual(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return;
    }

    $tabId = (string) ($GLOBALS["trace_tab_id"] ?? "default");
    unset($_SESSION["_trace_tabs"][$tabId]);
    if (!empty($_SESSION["_trace_tabs"])) {
        return;
    }

    $_SESSION = [];
    if (ini_get("session.use_cookies")) {
        $configuracoes = session_get_cookie_params();
        setcookie(
            session_name(),
            "",
            time() - 42000,
            $configuracoes["path"],
            $configuracoes["domain"],
            (bool) $configuracoes["secure"],
            (bool) $configuracoes["httponly"],
        );
    }
    session_destroy();
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

    if (in_array(strtolower($password), ["password", "password1234", "change-me-local", "change-me-root"], true)) {
        throw new RuntimeException("DB_PASSWORD não pode usar uma credencial padrão.");
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

/**
 * No PC industrial, a Dala cadastrada define o destino do CLP. Resolve o
 * endereço uma única vez e só permite IPv4 privado, evitando que a verificação
 * de conectividade alcance serviços públicos, loopback ou metadados da rede.
 */
function resolver_destino_clp_local(string $host, int $port): ?string
{
    if (!trace_e_instalacao_local() || $port < 1 || $port > 65535) {
        return null;
    }

    $host = trim($host);
    if ($host === "" || strlen($host) > 253) {
        return null;
    }

    $ip = filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4);
    if ($ip === false) {
        if (preg_match('/\A[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\z/i', $host) !== 1
            || preg_match('/\A[0-9.]+\z/', $host) === 1) {
            return null;
        }
        $ip = gethostbyname($host);
        if ($ip === $host || filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return null;
        }
    }

    $octets = array_map('intval', explode('.', $ip));
    $private = $octets[0] === 10
        || ($octets[0] === 172 && $octets[1] >= 16 && $octets[1] <= 31)
        || ($octets[0] === 192 && $octets[1] === 168);
    return $private ? $ip : null;
}

/** @return array{id:int, company_id:int, equipment_id:int, device_code:string, device_type:string} */
function require_device_token(array $allowedDeviceTypes = []): array
{
    $provided = trim((string) ($_SERVER["HTTP_X_DEVICE_TOKEN"] ?? ""));
    if ($provided === "") {
        responder_json(["error" => "Credencial do dispositivo ausente."], 401);
    }

    // Provisioned device tokens contain 256 random bits, so their indexed
    // SHA-256 digest can be compared directly without bcrypt per request.
    $statement = obter_conexao_banco()->prepare(
        "SELECT id, company_id, equipment_id, device_code, device_type, token_lookup_hash
         FROM dispositivos
         WHERE active = 1 AND token_lookup_hash = :token_lookup_hash
           AND (token_revoked_at IS NULL OR token_revoked_at > NOW())
           AND (token_expires_at IS NULL OR token_expires_at > NOW())
         LIMIT 1",
    );
    $statement->execute(["token_lookup_hash" => hash("sha256", $provided)]);
    $device = $statement->fetch();
    if (!$device || !hash_equals((string) $device["token_lookup_hash"], hash("sha256", $provided))) {
        responder_json(["error" => "Credencial do dispositivo inválida."], 401);
    }
    if ($allowedDeviceTypes !== [] && !in_array($device["device_type"], $allowedDeviceTypes, true)) {
        responder_json(["error" => "Dispositivo sem permissão para esta operação."], 403);
    }

    $touch = obter_conexao_banco()->prepare(
        "UPDATE dispositivos SET last_seen_at = NOW(), token_last_used_at = NOW()
         WHERE id = :id AND active = 1",
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

function credencial_instalacao_valida(string $token): bool
{
    return preg_match('/\A[a-f0-9]{64}\z/i', $token) === 1;
}

/** @return array{id:int,name:string,login_domain:string,license_status:string,license_reason:?string,installation_id:int,equipment_id:?int,installation_name:string,auto_link_first_dala:bool} */
function exigir_instalacao_remota(bool $permitirSemDala = false): array
{
    $token = token_bearer_instalacao();
    if (!credencial_instalacao_valida($token)) {
        responder_json(["error" => "Credencial da instalação ausente ou inválida."], 401);
    }

    $normalized = strtolower($token);
    $pdo = obter_conexao_banco();
    $statement = $pdo->prepare(
        "SELECT p.id AS installation_id, p.company_id, p.equipment_id, p.auto_link_first_dala,
                p.name AS installation_name, c.name, c.login_domain
         FROM instalacoes_industriais p
         JOIN empresas c ON c.id = p.company_id
         WHERE c.archived_at IS NULL AND p.archived_at IS NULL
           AND p.access_blocked_at IS NULL AND p.sync_token_hash = :token_hash
         LIMIT 1",
    );
    $statement->execute(["token_hash" => hash("sha256", $normalized)]);
    $installation = $statement->fetch();
    if (!$installation) {
        responder_json(["error" => "Credencial da instalação inválida."], 401);
    }
    if ($installation["equipment_id"] === null && !$permitirSemDala) {
        responder_json([
            "error" => "Este PC industrial ainda não está vinculado a uma Dala no servidor central.",
            "error_code" => "INSTALLATION_DALA_REQUIRED",
        ], 409);
    }

    // O código identifica a instalação, mas a licença decide se ela pode
    // continuar sincronizando. A mesma regra também é usada pelas rotas
    // operacionais autenticadas.
    $license = validar_licenca_ativa($pdo, (int) $installation["company_id"]);

    return [
        "id" => (int) $installation["company_id"],
        "name" => (string) $installation["name"],
        "login_domain" => (string) $installation["login_domain"],
        "license_status" => (string) $license["status"],
        "license_reason" => $license["blocked_reason"] !== null
            ? (string) $license["blocked_reason"]
            : null,
        "installation_id" => (int) $installation["installation_id"],
        "equipment_id" => $installation["equipment_id"] === null
            ? null
            : (int) $installation["equipment_id"],
        "installation_name" => (string) $installation["installation_name"],
        "auto_link_first_dala" => (bool) $installation["auto_link_first_dala"],
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
        encerrar_sessao_atual();
        responder_json([
            "error" => "Empresa sem licença configurada.",
            "error_code" => "LICENSE_INACTIVE",
            "license_status" => "SEM_LICENCA",
        ], 402);
    }

    if ($license["status"] !== "ATIVA") {
        encerrar_sessao_atual();
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

function exigir_instalacao_local_ativa(PDO $pdo, int $companyId): void
{
    if (!trace_e_instalacao_local()) {
        return;
    }

    $statement = $pdo->query(
        "SELECT company_id, sync_token, activated_at
         FROM instalacoes_locais
         WHERE id = 1
         LIMIT 1",
    );
    $installation = $statement->fetch();
    if (
        !$installation ||
        trim((string) ($installation["sync_token"] ?? "")) === "" ||
        trim((string) ($installation["activated_at"] ?? "")) === ""
    ) {
        encerrar_sessao_atual();
        responder_json([
            "error" => "O PC industrial desta instalação ainda não foi configurado.",
            "error_code" => "INSTALLATION_INACTIVE",
        ], 403);
    }

    $installedCompanyId = (int) $installation["company_id"];
    if ($companyId > 0 && $installedCompanyId !== $companyId) {
        encerrar_sessao_atual();
        responder_json([
            "error" => "O usuário não pertence à instalação local configurada.",
            "error_code" => "INSTALLATION_MISMATCH",
        ], 403);
    }

    validar_licenca_ativa($pdo, $installedCompanyId);
}

/** @deprecated Use exigir_instalacao_local_ativa() in new endpoints. */
function validar_licenca_local_se_ativada(PDO $pdo, int $companyId): void
{
    exigir_instalacao_local_ativa($pdo, $companyId);
}

/** @deprecated Use validar_licenca_ativa() in new endpoints. */
function require_active_license(PDO $pdo, int $companyId): array
{
    return validar_licenca_ativa($pdo, $companyId);
}

function gerar_token_csrf(): string
{
    $session =& trace_contexto_sessao();
    if (empty($session["csrf_token"])) {
        $session["csrf_token"] = bin2hex(random_bytes(32));
    }
    return (string) $session["csrf_token"];
}

/** @return array{code:string,hash:string,preview:string} */
function gerar_codigo_ativacao_empresa(): array
{
    $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    $part = static function (int $length) use ($alphabet): string {
        $value = "";
        for ($index = 0; $index < $length; $index++) {
            $value .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        return $value;
    };
    // 16 base32 characters provide 80 bits of entropy while keeping the
    // one-time setup code practical to type. Accept older codes during transition.
    $code = "TRC-" . implode("-", [$part(4), $part(4), $part(4), $part(4)]);
    $normalized = str_replace("-", "", $code);
    return [
        "code" => $code,
        "hash" => hash("sha256", $normalized),
        "preview" => substr($normalized, -4),
    ];
}

function codigo_ativacao_empresa_valido(string $codigo): bool
{
    return preg_match(
        '/\ATRC-(?:[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){3}|[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}){4})\z/',
        strtoupper(trim($codigo)),
    ) === 1;
}

function exigir_csrf(): void
{
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

function hash_limite_login_origem(string $identidade): string
{
    $ip = trim((string) ($_SERVER["REMOTE_ADDR"] ?? "unknown"));
    return hash("sha256", "login|" . $ip . "|" . strtolower(trim($identidade)));
}

function hash_limite_ativacao(string $codigo): string
{
    $ip = trim((string) ($_SERVER["REMOTE_ADDR"] ?? "unknown"));
    return hash("sha256", "activation|" . $ip . "|" . strtoupper(trim($codigo)));
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
    $connection = obter_conexao_banco();
    try {
        $connection->beginTransaction();
        $retryAfter = null;
        foreach ([
            [hash_limite_login_ip(), 30],
            [hash_limite_login_origem($identidade), 10],
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

function verificar_taxa_de_ativacao(string $codigo): void
{
    $connection = obter_conexao_banco();
    try {
        $connection->beginTransaction();
        $retryAfter = null;
        foreach ([
            [hash_limite_login_ip(), 30],
            // Pair the code bucket with the source IP to avoid global lockout
            // of an activation code by an unrelated client.
            [hash_limite_ativacao($codigo), 10],
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
    $statement = obter_conexao_banco()->prepare(
        "UPDATE limites_login
         SET attempts = 0, window_started_at = NOW(), blocked_until = NULL, violation_count = 0
         WHERE identity_hash = :identity_hash",
    );
    $statement->execute([
        "identity_hash" => hash_limite_login_origem($identidade),
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
    $session =& trace_contexto_sessao();
    return isset($session["user"]) && is_array($session["user"])
        ? $session["user"]
        : null;
}

function sessao_auth_version_compativel(int $sessionVersion, int $currentVersion): bool
{
    return $sessionVersion > 0 && $sessionVersion === $currentVersion;
}

function exigir_sessao_usuario(bool $permitirTrocaSenha = false): array
{
    $session =& trace_contexto_sessao();
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
        encerrar_sessao_atual();
        responder_json(["error" => "Sessão expirada ou acesso desativado."], 401);
    }
    $sessionAuthVersion = (int) ($session["auth_version"] ?? 0);
    // Sessões criadas antes do versionamento não carregam auth_version. Elas
    // precisam ser rejeitadas, nunca promovidas silenciosamente para uma
    // sessão atual, para que a rotação de senha/perfil invalide todo o legado.
    if (!sessao_auth_version_compativel($sessionAuthVersion, (int) $usuarioAtual["auth_version"])) {
        encerrar_sessao_atual();
        responder_json(["error" => "A sessão foi encerrada porque as credenciais foram alteradas."], 401);
    }
    $usuarioPublico = usuario_publico($usuarioAtual);
    if (($usuarioPublico["role"] ?? "") !== "ADMIN_DALLOGIX") {
        exigir_instalacao_local_ativa(
            obter_conexao_banco(),
            (int) ($usuarioPublico["company_id"] ?? 0),
        );
        if (!trace_e_instalacao_local()) {
            validar_licenca_ativa(
                obter_conexao_banco(),
                (int) ($usuarioPublico["company_id"] ?? 0),
            );
        }
    }
    $session["user"] = $usuarioPublico;
    $session["auth_version"] = (int) $usuarioAtual["auth_version"];
    $session["user_validated_at"] = time();
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
    $payload = trace_payload_com_correlacao($payload);
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
        : trace_uuid_v4();

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
    $payload = trace_payload_com_correlacao($payload);
    $companyId = filter_var(
        $usuario["company_id"] ?? $payload["company_id"] ?? null,
        FILTER_VALIDATE_INT,
    );
    if ($companyId === false || $companyId === null || (int) $companyId < 1) {
        throw new RuntimeException("Evento de sincronização sem empresa vinculada.");
    }

    $eventUuid = trace_uuid_v4();
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
                "correlation_id" => trace_correlation_id(),
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
