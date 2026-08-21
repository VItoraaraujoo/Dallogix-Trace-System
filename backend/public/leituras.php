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
if ($result === 'SEM_LEITURA') {
    $occurrence = $pdo->prepare('INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, \'FALHA_SEM_LEITURA\', 1, :description, :created_by)');
    $occurrence->execute(['company_id' => $user['company_id'], 'carregamento_id' => $loadingId, 'description' => 'Saco detectado pelo sensor sem código de barras válido.', 'created_by' => $user['id']]);
    $occurrenceId = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'FALHA_SEM_LEITURA', 'ocorrencia', $occurrenceId, ['carregamento_id' => (int) $loadingId, 'leitura_id' => $readingId]);
    $cameraStatus = trim((string) (getenv('CAMERA_CAPTURE_URL') ?: '')) !== '' ? 'SOLICITAR_CAPTURA' : 'NAO_CONFIGURADA';
}
json_response(['data' => ['id' => $readingId, 'result' => $result, 'barcode' => $barcode !== '' ? $barcode : null, 'attempt_number' => $attemptNumber, 'retry' => false, 'final' => true, 'occurrence_id' => $occurrenceId, 'camera_status' => $cameraStatus]], 201);
