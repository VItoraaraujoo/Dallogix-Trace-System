<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    if (!in_array($user['role'], ['ADMIN_DALLOGIX', 'ADMIN_EMPRESA', 'SUPERVISOR'], true)) {
        json_response(['error' => 'Perfil sem permissão para cadastrar produto.'], 403);
    }
    $payload = request_json();
    $code = trim((string) ($payload['code'] ?? ''));
    $name = trim((string) ($payload['name'] ?? ''));
    $barcode = trim((string) ($payload['barcode'] ?? ''));
    if ($code === '' || $name === '' || $barcode === '') {
        json_response(['error' => 'Código, nome e código de barras são obrigatórios.'], 422);
    }
    $pdo = db();
    try {
        $pdo->beginTransaction();
        $insert = $pdo->prepare('INSERT INTO products (company_id, code, name) VALUES (:company_id, :code, :name)');
        $insert->execute(['company_id' => $user['company_id'], 'code' => $code, 'name' => $name]);
        $productId = (int) $pdo->lastInsertId();
        $barcodeInsert = $pdo->prepare('INSERT INTO product_codes (product_id, barcode) VALUES (:product_id, :barcode)');
        $barcodeInsert->execute(['product_id' => $productId, 'barcode' => $barcode]);
        record_operational_event($pdo, $user, 'PRODUTO_CADASTRADO', 'produto', $productId, ['code' => $code, 'barcode' => $barcode]);
        $pdo->commit();
        json_response(['data' => ['id' => $productId, 'code' => $code, 'name' => $name, 'barcode' => $barcode]], 201);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        json_response(['error' => 'Produto ou código de barras já cadastrado.'], 409);
    }
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Método não permitido.'], 405);
}

$statement = db()->prepare('SELECT p.id, p.code, p.name, p.active, GROUP_CONCAT(pc.barcode ORDER BY pc.barcode SEPARATOR ",") AS barcodes FROM products p LEFT JOIN product_codes pc ON pc.product_id = p.id WHERE p.company_id = :company_id GROUP BY p.id ORDER BY p.code');
$statement->execute(['company_id' => $user['company_id']]);
json_response(['data' => $statement->fetchAll()]);
