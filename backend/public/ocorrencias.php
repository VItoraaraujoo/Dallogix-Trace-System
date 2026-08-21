<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($user['company_id'] === null) {
    json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
}

$pdo = db();
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $statement = $pdo->prepare('SELECT id, type, quantity, description, carregamento_id, created_at FROM ocorrencias WHERE company_id = :company_id ORDER BY id DESC LIMIT 50');
    $statement->execute(['company_id' => $user['company_id']]);
    json_response(['data' => $statement->fetchAll()]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['error' => 'Método não permitido.'], 405);
}

$payload = request_json();
$type = trim((string) ($payload['type'] ?? ''));
$description = trim((string) ($payload['description'] ?? ''));
$quantity = filter_var($payload['quantity'] ?? 1, FILTER_VALIDATE_INT);
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
if ($type === '' || $quantity === false || $quantity < 1) {
    json_response(['error' => 'Tipo e quantidade válida são obrigatórios.'], 422);
}
if ($loadingId) {
    $loading = $pdo->prepare('SELECT id FROM carregamentos WHERE id = :id AND company_id = :company_id LIMIT 1');
    $loading->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
    if (!$loading->fetch()) json_response(['error' => 'Carregamento não pertence à empresa.'], 422);
}

$insert = $pdo->prepare('INSERT INTO ocorrencias (company_id, carregamento_id, type, quantity, description, created_by) VALUES (:company_id, :carregamento_id, :type, :quantity, :description, :created_by)');
$insert->execute(['company_id' => $user['company_id'], 'carregamento_id' => $loadingId ?: null, 'type' => $type, 'quantity' => $quantity, 'description' => $description !== '' ? $description : null, 'created_by' => $user['id']]);
$occurrenceId = (int) $pdo->lastInsertId();
record_operational_event($pdo, $user, 'OCORRENCIA_REGISTRADA', 'ocorrencia', $occurrenceId, ['type' => $type, 'quantity' => $quantity, 'carregamento_id' => $loadingId]);
json_response(['data' => ['id' => $occurrenceId, 'type' => $type, 'quantity' => $quantity]], 201);
