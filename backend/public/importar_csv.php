<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'Método não permitido.'], 405);
require_csrf();
if ($user['company_id'] === null) json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) json_response(['error' => 'Envie um arquivo CSV válido.'], 422);
if ((int) ($_FILES['file']['size'] ?? 0) > 5 * 1024 * 1024) json_response(['error' => 'CSV excede o limite de 5 MB.'], 413);

$handle = fopen($_FILES['file']['tmp_name'], 'rb');
if ($handle === false) json_response(['error' => 'Não foi possível ler o arquivo CSV.'], 422);

$rows = [];
while (($row = fgetcsv($handle, 0, ';')) !== false) {
    if (count(array_filter($row, static fn ($value) => trim((string) $value) !== '')) === 0) continue;
    $rows[] = array_map(static fn ($value) => trim((string) $value), $row);
    if (count($rows) > 10000) json_response(['error' => 'CSV excede o limite de 10.000 linhas.'], 413);
}
fclose($handle);
if (count($rows) < 2) json_response(['error' => 'CSV vazio ou sem linhas de dados.'], 422);

$header = array_map('strtolower', $rows[0]);
$required = ['romaneio', 'data', 'placa', 'produto', 'quantidade'];
foreach ($required as $column) {
    if (!in_array($column, $header, true)) json_response(['error' => "Coluna obrigatória ausente: {$column}."], 422);
}
$index = array_flip($header);
$pdo = db();
$created = 0;
$romaneioIds = [];
$truckIds = [];
try {
    $pdo->beginTransaction();
    foreach (array_slice($rows, 1) as $line => $row) {
        $lineNumber = $line + 2;
        $number = trim((string) ($row[$index['romaneio']] ?? ''));
        $dateValue = trim((string) ($row[$index['data']] ?? ''));
        $plate = strtoupper(trim((string) ($row[$index['placa']] ?? '')));
        $productCode = trim((string) ($row[$index['produto']] ?? ''));
        $quantity = filter_var($row[$index['quantidade']] ?? null, FILTER_VALIDATE_INT);
        $date = DateTime::createFromFormat('Y-m-d', $dateValue);
        if ($number === '' || $plate === '' || $productCode === '' || $quantity === false || $quantity < 1 || !$date || $date->format('Y-m-d') !== $dateValue) {
            throw new RuntimeException("Linha {$lineNumber} inválida.");
        }

        $productStatement = $pdo->prepare('SELECT id FROM products WHERE company_id = :company_id AND code = :code AND active = 1 LIMIT 1');
        $productStatement->execute(['company_id' => $user['company_id'], 'code' => $productCode]);
        $product = $productStatement->fetch();
        if (!$product) throw new RuntimeException("Produto {$productCode} não encontrado na linha {$lineNumber}.");

        if (!isset($romaneioIds[$number])) {
            $romaneioStatement = $pdo->prepare('INSERT INTO romaneios (company_id, number, scheduled_date, status) VALUES (:company_id, :number, :scheduled_date, \'IMPORTADO\')');
            $romaneioStatement->execute(['company_id' => $user['company_id'], 'number' => $number, 'scheduled_date' => $dateValue]);
            $romaneioIds[$number] = (int) $pdo->lastInsertId();
        }
        $romaneioId = $romaneioIds[$number];
        $truckKey = $number . '|' . $plate;
        if (!isset($truckIds[$truckKey])) {
            $truckStatement = $pdo->prepare('INSERT INTO romaneio_trucks (romaneio_id, plate) VALUES (:romaneio_id, :plate)');
            $truckStatement->execute(['romaneio_id' => $romaneioId, 'plate' => $plate]);
            $truckIds[$truckKey] = (int) $pdo->lastInsertId();
        }
        $itemStatement = $pdo->prepare('INSERT INTO romaneio_items (romaneio_id, product_id, truck_id, planned_quantity) VALUES (:romaneio_id, :product_id, :truck_id, :quantity)');
        $itemStatement->execute(['romaneio_id' => $romaneioId, 'product_id' => $product['id'], 'truck_id' => $truckIds[$truckKey], 'quantity' => $quantity]);
        $created++;
    }
    $pdo->commit();
    foreach ($romaneioIds as $number => $romaneioId) record_operational_event($pdo, $user, 'ROMANEIO_IMPORTADO_CSV', 'romaneio', $romaneioId, ['number' => $number, 'items' => $created]);
    json_response(['data' => ['romaneios' => count($romaneioIds), 'items' => $created]], 201);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($exception instanceof PDOException && isset($exception->errorInfo[1]) && (int) $exception->errorInfo[1] === 1062) json_response(['error' => 'O CSV contém romaneio ou caminhão duplicado.'], 409);
    json_response(['error' => $exception->getMessage()], 422);
}
