<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_role(['ADMIN_DALLOGIX', 'ADMIN_EMPRESA', 'SUPERVISOR', 'MANUTENCAO']);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}
require_csrf();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$payload = request_json();
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
if (!$loadingId) {
    json_response(['error' => 'Carregamento é obrigatório.'], 422);
}

$pdo = db();
$pdo->beginTransaction();
try {
    $currentStatement = $pdo->prepare('SELECT id, state FROM carregamentos WHERE id = :id AND company_id = :company_id FOR UPDATE');
    $currentStatement->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
    $current = $currentStatement->fetch();
    if (!$current) {
        $pdo->rollBack();
        json_response(['error' => 'Carregamento não encontrado para esta empresa.'], 404);
    }
    if ($current['state'] !== 'EMERGENCIA') {
        $pdo->rollBack();
        json_response(['error' => 'A máquina não está bloqueada por emergência.'], 409);
    }

    $update = $pdo->prepare("UPDATE carregamentos SET state = 'PREPARANDO' WHERE id = :id AND company_id = :company_id");
    $update->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
    record_operational_event($pdo, $user, 'MAQUINA_DESBLOQUEADA', 'carregamento', (int) $loadingId, [
        'previous_state' => 'EMERGENCIA',
        'state' => 'PREPARANDO',
        'command' => 'DESBLOQUEAR_MAQUINA',
    ]);
    $pdo->commit();
    json_response(['data' => [
        'id' => (int) $loadingId,
        'previous_state' => 'EMERGENCIA',
        'state' => 'PREPARANDO',
        'command' => 'DESBLOQUEAR_MAQUINA',
    ]]);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('Machine unlock failed: ' . $exception->getMessage());
    json_response(['error' => 'Não foi possível desbloquear a máquina.'], 500);
}
