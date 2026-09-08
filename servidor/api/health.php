<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

try {
    obter_conexao_banco()->query("SELECT 1");
    responder_json(["status" => "ok", "php" => true, "mysql" => true]);
} catch (Throwable $error) {
    error_log("Healthcheck banco-de-dados failure: " . $error->getMessage());
    responder_json(
        ["status" => "degraded", "php" => true, "mysql" => false],
        503,
    );
}
