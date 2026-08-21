<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$payload = request_json();
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
$sensorEventId = filter_var($payload['sensor_event_id'] ?? null, FILTER_VALIDATE_INT);
$barcode = trim((string) ($payload['barcode'] ?? ''));
$attemptNumber = filter_var($payload['attempt_number'] ?? 1, FILTER_VALIDATE_INT);
if (!$loadingId) {
    json_response(['error' => 'Carregamento obrigatório.'], 422);
}
if ($attemptNumber === false || $attemptNumber < 1 || $attemptNumber > 2) {
    json_response(['error' => 'A tentativa de leitura deve ser 1 ou 2.'], 422);
}

$pdo = db();
$loadingStatement = $pdo->prepare(
    'SELECT c.id, c.romaneio_id, c.truck_id, c.equipment_id
     FROM carregamentos c
     WHERE c.id = :id AND c.company_id = :company_id LIMIT 1'
);
$loadingStatement->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
$loading = $loadingStatement->fetch();
if (!$loading) {
    json_response(['error' => 'Carregamento não encontrado para esta empresa.'], 404);
}

$plannedStatement = $pdo->prepare('SELECT COALESCE(SUM(ri.planned_quantity), 0) FROM romaneio_items ri WHERE ri.romaneio_id = :romaneio_id AND (ri.truck_id = :truck_id OR ri.truck_id IS NULL)');
$plannedStatement->execute(['romaneio_id' => $loading['romaneio_id'], 'truck_id' => $loading['truck_id']]);
$plannedQuantity = (int) $plannedStatement->fetchColumn();
$validCountStatement = $pdo->prepare("SELECT COUNT(*) FROM leituras WHERE carregamento_id = :carregamento_id AND result = 'VALIDO'");
$validCountStatement->execute(['carregamento_id' => $loadingId]);
$validCount = (int) $validCountStatement->fetchColumn();
if ($plannedQuantity > 0 && $validCount >= $plannedQuantity) {
    json_response(['error' => 'Quantidade planejada já foi carregada.', 'data' => ['load_status' => 'COMPLETO', 'planned_quantity' => $plannedQuantity, 'valid_readings' => $validCount, 'excesso' => false]], 409);
}

if ($sensorEventId) {
    $sensorStatement = $pdo->prepare('SELECT id FROM sensor_events WHERE id = :sensor_event_id AND carregamento_id = :carregamento_id AND equipment_id = :equipment_id LIMIT 1');
    $sensorStatement->execute(['sensor_event_id' => $sensorEventId, 'carregamento_id' => $loadingId, 'equipment_id' => $loading['equipment_id']]);
    if (!$sensorStatement->fetch()) json_response(['error' => 'Evento de sensor não pertence ao carregamento.'], 422);
}

$result = 'SEM_LEITURA';
$productId = null;
if ($barcode !== '') {
    $productStatement = $pdo->prepare(
        'SELECT p.id
         FROM product_codes pc
         JOIN products p ON p.id = pc.product_id AND p.company_id = :company_id
         WHERE pc.barcode = :barcode AND p.active = 1 LIMIT 1'
    );
    $productStatement->execute(['company_id' => $user['company_id'], 'barcode' => $barcode]);
    $product = $productStatement->fetch();
    if ($product) {
        $plannedStatement = $pdo->prepare('SELECT 1 FROM romaneio_items WHERE romaneio_id = :romaneio_id AND product_id = :product_id AND (truck_id = :truck_id OR truck_id IS NULL) LIMIT 1');
        $plannedStatement->execute(['romaneio_id' => $loading['romaneio_id'], 'product_id' => $product['id'], 'truck_id' => $loading['truck_id']]);
        $productId = (int) $product['id'];
        $result = $plannedStatement->fetch() ? 'VALIDO' : 'PRODUTO_INCORRETO';
    } else {
        $result = 'PRODUTO_INCORRETO';
    }
}

$insert = $pdo->prepare('INSERT INTO leituras (carregamento_id, product_id, barcode, attempt_number, result, read_at) VALUES (:carregamento_id, :product_id, :barcode, :attempt_number, :result, NOW(3))');
$insert->execute(['carregamento_id' => $loadingId, 'product_id' => $productId, 'barcode' => $barcode !== '' ? $barcode : null, 'attempt_number' => $attemptNumber, 'result' => $result]);
$readingId = (int) $pdo->lastInsertId();
record_operational_event($pdo, $user, 'LEITURA_REGISTRADA', 'leitura', $readingId, ['carregamento_id' => (int) $loadingId, 'result' => $result, 'barcode' => $barcode, 'attempt_number' => $attemptNumber]);
$occurrenceId = null;
$cameraStatus = 'NAO_SOLICITADA';
if ($result === 'VALIDO' && $sensorEventId) {
    $discard = $pdo->prepare("UPDATE camera_capture_requests SET status = 'DESCARTADA', updated_at = NOW() WHERE sensor_event_id = :sensor_event_id AND status = 'PENDENTE'");
    $discard->execute(['sensor_event_id' => $sensorEventId]);
    $cameraStatus = 'DESCARTADA_EVENTO_NORMAL';
}
if ($result === 'SEM_LEITURA') {
    $occurrence = $pdo->prepare('INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, \'FALHA_SEM_LEITURA\', 1, :description, :created_by)');
    $occurrence->execute(['company_id' => $user['company_id'], 'carregamento_id' => $loadingId, 'description' => 'Saco detectado pelo sensor sem código de barras válido.', 'created_by' => $user['id']]);
    $occurrenceId = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'FALHA_SEM_LEITURA', 'ocorrencia', $occurrenceId, ['carregamento_id' => (int) $loadingId, 'leitura_id' => $readingId]);
    $cameraStatus = 'CAPTURA_PENDENTE_INCIDENTE';
}
if ($result === 'PRODUTO_INCORRETO') {
    $occurrence = $pdo->prepare('INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, \'PRODUTO_INCORRETO\', 1, :description, :created_by)');
    $occurrence->execute(['company_id' => $user['company_id'], 'carregamento_id' => $loadingId, 'description' => 'Produto lido não está previsto para o carregamento.', 'created_by' => $user['id']]);
    $occurrenceId = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'PRODUTO_INCORRETO', 'ocorrencia', $occurrenceId, ['carregamento_id' => (int) $loadingId, 'leitura_id' => $readingId]);
    $cameraStatus = 'CAPTURA_PENDENTE_INCIDENTE';
}
$loadStatus = 'EM_ANDAMENTO';
if ($result === 'VALIDO' && $plannedQuantity > 0 && ($validCount + 1) >= $plannedQuantity) {
    $stateUpdate = $pdo->prepare("UPDATE carregamentos SET state = 'FINALIZANDO' WHERE id = :id AND state IN ('PREPARANDO', 'CARREGANDO', 'PAUSADO')");
    $stateUpdate->execute(['id' => $loadingId]);
    record_operational_event($pdo, $user, 'QUANTIDADE_PLANEJADA_ATINGIDA', 'carregamento', (int) $loadingId, ['planned_quantity' => $plannedQuantity, 'valid_readings' => $validCount + 1]);
    $loadStatus = 'COMPLETO';
}
json_response(['data' => ['id' => $readingId, 'result' => $result, 'barcode' => $barcode !== '' ? $barcode : null, 'attempt_number' => $attemptNumber, 'retry' => false, 'final' => true, 'occurrence_id' => $occurrenceId, 'camera_status' => $cameraStatus, 'load_status' => $loadStatus, 'excesso' => false]], 201);
