<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $statement = db()->prepare(
        'SELECT c.id, c.state, c.started_at, c.finished_at,
                r.number AS romaneio_number, rt.plate, e.equipment_code,
                COALESCE((SELECT SUM(ri.planned_quantity) FROM romaneio_items ri WHERE ri.romaneio_id = c.romaneio_id AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)), 0) AS planned_quantity,
                (SELECT COUNT(*) FROM leituras l WHERE l.carregamento_id = c.id AND l.result = "VALIDO") AS valid_readings
         FROM carregamentos c
         JOIN romaneios r ON r.id = c.romaneio_id
         JOIN romaneio_trucks rt ON rt.id = c.truck_id
         JOIN equipments e ON e.id = c.equipment_id
         WHERE c.company_id = :company_id
         ORDER BY c.id DESC'
    );
    $statement->execute(['company_id' => $user['company_id']]);
    json_response(['data' => $statement->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}
require_csrf();

$payload = request_json();
$romaneioId = filter_var($payload['romaneio_id'] ?? null, FILTER_VALIDATE_INT);
$truckId = filter_var($payload['truck_id'] ?? null, FILTER_VALIDATE_INT);
$equipmentId = filter_var($payload['equipment_id'] ?? ($payload['esteira_id'] ?? null), FILTER_VALIDATE_INT);
if (!$romaneioId || !$truckId || !$equipmentId) {
    json_response(['error' => 'Romaneio, caminhão e esteira são obrigatórios.'], 422);
}

$statement = db()->prepare(
    'SELECT r.id AS romaneio_id, rt.id AS truck_id, e.id AS equipment_id
     FROM romaneios r
     JOIN romaneio_trucks rt ON rt.romaneio_id = r.id
     JOIN equipments e ON e.id = :equipment_id AND e.company_id = r.company_id
     WHERE r.id = :romaneio_id AND rt.id = :truck_id AND r.company_id = :company_id LIMIT 1'
);
$statement->execute(['equipment_id' => $equipmentId, 'romaneio_id' => $romaneioId, 'truck_id' => $truckId, 'company_id' => $user['company_id']]);
$valid = $statement->fetch();
if (!$valid) {
    json_response(['error' => 'Romaneio, caminhão ou equipamento não pertence à empresa.'], 422);
}

$insert = db()->prepare('INSERT INTO carregamentos (company_id, equipment_id, romaneio_id, truck_id, state, started_at) VALUES (:company_id, :equipment_id, :romaneio_id, :truck_id, \'PREPARANDO\', NOW())');
$insert->execute(['company_id' => $user['company_id'], 'equipment_id' => $equipmentId, 'romaneio_id' => $romaneioId, 'truck_id' => $truckId]);
json_response(['data' => ['id' => (int) db()->lastInsertId(), 'state' => 'PREPARANDO']], 201);
