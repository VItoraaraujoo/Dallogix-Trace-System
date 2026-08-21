<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}
require_csrf();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$payload = request_json();
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
$equipmentId = filter_var($payload['equipment_id'] ?? ($payload['esteira_id'] ?? null), FILTER_VALIDATE_INT);
$eventUuid = trim((string) ($payload['event_uuid'] ?? ''));
$detectedAt = trim((string) ($payload['detected_at'] ?? ''));
if (!$loadingId || !$equipmentId || !preg_match('/^[a-f0-9-]{36}$/i', $eventUuid)) {
    json_response(['error' => 'Carregamento, esteira e event_uuid válido são obrigatórios.'], 422);
}

$loadingStatement = db()->prepare(
    'SELECT c.id FROM carregamentos c
     JOIN equipments e ON e.id = c.equipment_id AND e.id = :equipment_id
     WHERE c.id = :loading_id AND c.company_id = :company_id LIMIT 1'
);
$loadingStatement->execute(['equipment_id' => $equipmentId, 'loading_id' => $loadingId, 'company_id' => $user['company_id']]);
if (!$loadingStatement->fetch()) {
    json_response(['error' => 'Carregamento e esteira não pertencem à empresa.'], 422);
}

$eventDate = $detectedAt !== '' ? DateTime::createFromFormat('Y-m-d H:i:s.v', $detectedAt) : new DateTime();
if (!$eventDate) {
    json_response(['error' => 'Data do evento inválida.'], 422);
}

$pdo = db();
try {
    $insert = $pdo->prepare('INSERT INTO sensor_events (carregamento_id, equipment_id, event_uuid, detected_at) VALUES (:carregamento_id, :equipment_id, :event_uuid, :detected_at)');
    $insert->execute(['carregamento_id' => $loadingId, 'equipment_id' => $equipmentId, 'event_uuid' => $eventUuid, 'detected_at' => $eventDate->format('Y-m-d H:i:s.v')]);
    $eventId = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'SENSOR_EVENTO_RECEBIDO', 'sensor_event', $eventId, ['carregamento_id' => (int) $loadingId, 'event_uuid' => $eventUuid]);
    $cameraRequest = $pdo->prepare('INSERT INTO camera_capture_requests (sensor_event_id, carregamento_id, equipment_id, requested_at) VALUES (:sensor_event_id, :carregamento_id, :equipment_id, NOW(3))');
    $cameraRequest->execute(['sensor_event_id' => $eventId, 'carregamento_id' => $loadingId, 'equipment_id' => $equipmentId]);
    $cameraRequestId = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'CAMERA_CAPTURA_SOLICITADA', 'camera_request', $cameraRequestId, ['sensor_event_id' => $eventId, 'captura_no_evento' => true]);
    json_response(['data' => ['id' => $eventId, 'duplicate' => false, 'camera_request_id' => $cameraRequestId, 'camera_trigger' => 'IMEDIATO']], 201);
} catch (PDOException $exception) {
    if (isset($exception->errorInfo[1]) && (int) $exception->errorInfo[1] === 1062) {
        $existing = $pdo->prepare('SELECT id FROM sensor_events WHERE event_uuid = :event_uuid LIMIT 1');
        $existing->execute(['event_uuid' => $eventUuid]);
        json_response(['data' => ['id' => (int) $existing->fetchColumn(), 'duplicate' => true]], 200);
    }
    json_response(['error' => 'Não foi possível registrar o evento do sensor.'], 500);
}
