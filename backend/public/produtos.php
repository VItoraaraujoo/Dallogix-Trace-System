<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Método não permitido.'], 405);
}
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$statement = db()->prepare('SELECT p.id, p.code, p.name, p.active, GROUP_CONCAT(pc.barcode ORDER BY pc.barcode SEPARATOR ",") AS barcodes FROM products p LEFT JOIN product_codes pc ON pc.product_id = p.id WHERE p.company_id = :company_id GROUP BY p.id ORDER BY p.code');
$statement->execute(['company_id' => $user['company_id']]);
json_response(['data' => $statement->fetchAll()]);
