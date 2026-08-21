<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
$companyId = $user['company_id'];
if ($companyId === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $statement = db()->prepare(
        'SELECT r.id, r.number, r.scheduled_date, r.status,
                COUNT(DISTINCT rt.id) AS trucks_count,
                COALESCE((SELECT SUM(ri2.planned_quantity) FROM romaneio_items ri2 WHERE ri2.romaneio_id = r.id), 0) AS planned_quantity
         FROM romaneios r
         LEFT JOIN romaneio_trucks rt ON rt.romaneio_id = r.id
         LEFT JOIN romaneio_items ri ON ri.romaneio_id = r.id
         WHERE r.company_id = :company_id
         GROUP BY r.id
         ORDER BY r.scheduled_date DESC, r.id DESC'
    );
    $statement->execute(['company_id' => $companyId]);
    json_response(['data' => $statement->fetchAll()]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}
require_csrf();

$payload = request_json();
$number = trim((string) ($payload['number'] ?? ''));
$scheduledDate = trim((string) ($payload['scheduled_date'] ?? date('Y-m-d')));
$plate = strtoupper(trim((string) ($payload['plate'] ?? '')));
$driverName = trim((string) ($payload['driver_name'] ?? ''));
$productCode = trim((string) ($payload['product_code'] ?? ''));
$quantity = filter_var($payload['planned_quantity'] ?? null, FILTER_VALIDATE_INT);

if ($number === '' || $plate === '' || $productCode === '' || $quantity === false || $quantity < 1) {
    json_response(['error' => 'Número, caminhão, produto e quantidade válida são obrigatórios.'], 422);
}
$date = DateTime::createFromFormat('Y-m-d', $scheduledDate);
if (!$date || $date->format('Y-m-d') !== $scheduledDate) {
    json_response(['error' => 'Data programada inválida.'], 422);
}

$pdo = db();
try {
    $pdo->beginTransaction();
    $productStatement = $pdo->prepare('SELECT id FROM products WHERE company_id = :company_id AND code = :code AND active = 1 LIMIT 1');
    $productStatement->execute(['company_id' => $companyId, 'code' => $productCode]);
    $product = $productStatement->fetch();
    if (!$product) {
        $pdo->rollBack();
        json_response(['error' => 'Produto não encontrado para esta empresa.'], 422);
    }

    $romaneioStatement = $pdo->prepare('INSERT INTO romaneios (company_id, number, scheduled_date, status) VALUES (:company_id, :number, :scheduled_date, \'AGUARDANDO\')');
    $romaneioStatement->execute(['company_id' => $companyId, 'number' => $number, 'scheduled_date' => $scheduledDate]);
    $romaneioId = (int) $pdo->lastInsertId();

    $truckStatement = $pdo->prepare('INSERT INTO romaneio_trucks (romaneio_id, plate, driver_name) VALUES (:romaneio_id, :plate, :driver_name)');
    $truckStatement->execute(['romaneio_id' => $romaneioId, 'plate' => $plate, 'driver_name' => $driverName !== '' ? $driverName : null]);
    $truckId = (int) $pdo->lastInsertId();

    $itemStatement = $pdo->prepare('INSERT INTO romaneio_items (romaneio_id, product_id, truck_id, planned_quantity) VALUES (:romaneio_id, :product_id, :truck_id, :planned_quantity)');
    $itemStatement->execute(['romaneio_id' => $romaneioId, 'product_id' => $product['id'], 'truck_id' => $truckId, 'planned_quantity' => $quantity]);
    $pdo->commit();
    record_operational_event($pdo, $user, 'ROMANEIO_CRIADO', 'romaneio', $romaneioId, ['number' => $number, 'truck_id' => $truckId, 'planned_quantity' => $quantity]);

    json_response(['data' => ['id' => $romaneioId, 'number' => $number, 'truck_id' => $truckId, 'status' => 'AGUARDANDO']], 201);
} catch (PDOException $exception) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ((int) $exception->errorInfo[1] === 1062) {
        json_response(['error' => 'Já existe um romaneio com este número.'], 409);
    }
    json_response(['error' => 'Não foi possível salvar o romaneio.'], 500);
}
