<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$expectedToken = trim((string) (getenv('CAMERA_INTERNAL_TOKEN') ?: ''));
$providedToken = trim((string) ($_SERVER['HTTP_X_INTERNAL_TOKEN'] ?? ''));
if ($expectedToken === '' || !hash_equals($expectedToken, $providedToken)) {
    json_response(['error' => 'Token interno inválido.'], 401);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'Método não permitido.'], 405);

$payload = request_json();
$action = strtoupper(trim((string) ($payload['action'] ?? 'CLAIM')));
$pdo = db();

if ($action === 'CLAIM') {
    $pdo->beginTransaction();
    $statement = $pdo->query("SELECT id, sensor_event_id, carregamento_id, equipment_id FROM camera_capture_requests WHERE status = 'PENDENTE' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
    $request = $statement->fetch();
    if (!$request) {
        $pdo->commit();
        json_response(['data' => null], 204);
    }
    $update = $pdo->prepare("UPDATE camera_capture_requests SET status = 'CAPTURANDO' WHERE id = :id");
    $update->execute(['id' => $request['id']]);
    $pdo->commit();
    json_response(['data' => $request]);
}

if ($action !== 'COMPLETE') json_response(['error' => 'Ação inválida.'], 422);
$requestId = filter_var($payload['request_id'] ?? null, FILTER_VALIDATE_INT);
$imagePath = trim((string) ($payload['image_path'] ?? ''));
if (!$requestId || $imagePath === '') json_response(['error' => 'request_id e image_path são obrigatórios.'], 422);

$request = $pdo->prepare('SELECT id, carregamento_id, equipment_id FROM camera_capture_requests WHERE id = :id AND status = \'CAPTURANDO\' LIMIT 1');
$request->execute(['id' => $requestId]);
$capture = $request->fetch();
if (!$capture) json_response(['error' => 'Pedido de captura não está em processamento.'], 404);

$update = $pdo->prepare("UPDATE camera_capture_requests SET status = 'CAPTURADA', captured_at = NOW(3), image_path = :image_path, error_message = NULL WHERE id = :id");
$update->execute(['image_path' => $imagePath, 'id' => $requestId]);
$image = $pdo->prepare('INSERT INTO imagens (carregamento_id, equipment_id, path, reason, captured_at) VALUES (:carregamento_id, :equipment_id, :path, \'SEM_LEITURA\', NOW())');
$image->execute(['carregamento_id' => $capture['carregamento_id'], 'equipment_id' => $capture['equipment_id'], 'path' => $imagePath]);
json_response(['data' => ['request_id' => (int) $requestId, 'image_id' => (int) $pdo->lastInsertId(), 'status' => 'CAPTURADA']]);
