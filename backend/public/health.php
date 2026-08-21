<?php
declare(strict_types=1);
require_once __DIR__ . '/../config/bootstrap.php';

try {
    db()->query('SELECT 1');
    json_response(['status' => 'ok', 'php' => true, 'mysql' => true]);
} catch (Throwable $error) {
    error_log('Healthcheck database failure: ' . $error->getMessage());
    json_response(['status' => 'degraded', 'php' => true, 'mysql' => false], 503);
}
