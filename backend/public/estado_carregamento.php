<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    json_response(['error' => 'Método não permitido.'], 405);
}
require_csrf();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$payload = request_json();
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
$target = strtoupper(trim((string) ($payload['state'] ?? '')));
$allowed = [
    'AGUARDANDO' => ['PREPARANDO'],
    'PREPARANDO' => ['CARREGANDO', 'PAUSADO', 'EMERGENCIA'],
    'CARREGANDO' => ['PAUSADO', 'FINALIZANDO', 'EMERGENCIA'],
    'PAUSADO' => ['CARREGANDO', 'EMERGENCIA'],
    'FINALIZANDO' => ['FINALIZADO', 'EMERGENCIA'],
    'EMERGENCIA' => ['PREPARANDO'],
    'FINALIZADO' => [],
];
if (!$loadingId || !array_key_exists($target, $allowed)) {
    json_response(['error' => 'Carregamento e estado válido são obrigatórios.'], 422);
}

$pdo = db();
$currentStatement = $pdo->prepare('SELECT id, state FROM carregamentos WHERE id = :id AND company_id = :company_id LIMIT 1');
$currentStatement->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
$current = $currentStatement->fetch();
if (!$current) {
    json_response(['error' => 'Carregamento não encontrado para esta empresa.'], 404);
}
if ($target === $current['state']) {
    json_response(['data' => ['id' => (int) $loadingId, 'previous_state' => $current['state'], 'state' => $target, 'changed' => false]]);
}
if (!in_array($target, $allowed[$current['state']], true)) {
    json_response(['error' => "Transição inválida: {$current['state']} para {$target}."], 409);
}
if ($current['state'] === 'EMERGENCIA' && $target === 'PREPARANDO' && $user['role'] === 'OPERADOR') {
    json_response(['error' => 'Operador não pode liberar uma emergência.'], 403);
}

$finishedAt = $target === 'FINALIZADO' ? ', finished_at = NOW()' : '';
$update = $pdo->prepare("UPDATE carregamentos SET state = :state{$finishedAt} WHERE id = :id AND company_id = :company_id");
$update->execute(['state' => $target, 'id' => $loadingId, 'company_id' => $user['company_id']]);
record_operational_event($pdo, $user, 'ESTADO_CARREGAMENTO_ALTERADO', 'carregamento', (int) $loadingId, ['previous_state' => $current['state'], 'state' => $target]);
json_response(['data' => ['id' => (int) $loadingId, 'previous_state' => $current['state'], 'state' => $target]]);
