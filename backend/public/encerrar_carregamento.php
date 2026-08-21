<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'Método não permitido.'], 405);
require_csrf();
if ($user['company_id'] === null) json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
$payload = request_json();
$loadingId = filter_var($payload['carregamento_id'] ?? null, FILTER_VALIDATE_INT);
if (!$loadingId) json_response(['error' => 'Carregamento obrigatório.'], 422);

$pdo = db();
$statement = $pdo->prepare('SELECT id, state FROM carregamentos WHERE id = :id AND company_id = :company_id LIMIT 1');
$statement->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
$loading = $statement->fetch();
if (!$loading) json_response(['error' => 'Carregamento não encontrado.'], 404);
if (!in_array($loading['state'], ['CARREGANDO', 'FINALIZANDO'], true)) json_response(['error' => "Carregamento em estado {$loading['state']} não pode ser encerrado."], 409);

$pending = $pdo->prepare("SELECT COUNT(*) FROM camera_capture_requests WHERE carregamento_id = :id AND status IN ('PENDENTE','CAPTURANDO')");
$pending->execute(['id' => $loadingId]);
if ((int) $pending->fetchColumn() > 0) json_response(['error' => 'Existem capturas de incidentes pendentes antes do encerramento.'], 409);

$update = $pdo->prepare("UPDATE carregamentos SET state = 'FINALIZADO', finished_at = NOW() WHERE id = :id AND company_id = :company_id");
$update->execute(['id' => $loadingId, 'company_id' => $user['company_id']]);
record_operational_event($pdo, $user, 'CARREGAMENTO_FINALIZADO', 'carregamento', (int) $loadingId);
json_response(['data' => ['id' => (int) $loadingId, 'state' => 'FINALIZADO']]);
