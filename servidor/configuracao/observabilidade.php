<?php

declare(strict_types=1);

/**
 * Identificador estável da requisição para cruzar API, auditoria, fila e logs.
 * O cliente pode enviar X-Correlation-ID; valores fora do formato seguro são
 * substituídos para impedir injeção de cabeçalhos ou poluição dos logs.
 */
function trace_correlation_id(): string
{
    static $id = null;
    if ($id !== null) {
        return $id;
    }

    $provided = trim((string) ($_SERVER["HTTP_X_CORRELATION_ID"] ?? $_SERVER["HTTP_X_REQUEST_ID"] ?? ""));
    $id = preg_match('/\A[A-Za-z0-9._:-]{8,80}\z/', $provided) === 1
        ? $provided
        : bin2hex(random_bytes(16));

    if (!headers_sent()) {
        header("X-Correlation-ID: {$id}");
    }
    return $id;
}

/** @param array<string,mixed> $payload @return array<string,mixed> */
function trace_payload_com_correlacao(array $payload): array
{
    $provided = trim((string) ($payload["correlation_id"] ?? ""));
    if (preg_match('/\A[A-Za-z0-9._:-]{8,80}\z/', $provided) !== 1) {
        $payload["correlation_id"] = trace_correlation_id();
    }
    return $payload;
}

function trace_detalhes_prontidao_autorizados(): bool
{
    $configured = trim((string) (getenv("TRACE_READINESS_TOKEN") ?: ""));
    $provided = trim((string) ($_SERVER["HTTP_X_TRACE_READINESS_TOKEN"] ?? ""));
    if ($configured !== "" && $provided !== "" && hash_equals($configured, $provided)) {
        return true;
    }

    $user = isset($_SESSION["user"]) && is_array($_SESSION["user"])
        ? $_SESSION["user"]
        : null;
    return is_array($user) && in_array(
        strtoupper((string) ($user["role"] ?? "")),
        ["ADMIN_DALLOGIX", "ADMIN_EMPRESA", "SUPERVISOR"],
        true,
    );
}
