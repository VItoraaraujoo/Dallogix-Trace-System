<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = require_session_user();
if ($user['company_id'] === null) json_response(['error' => 'Usuário sem empresa vinculada.'], 403);
$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $query = $pdo->prepare('SELECT id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol FROM equipments WHERE company_id = :company_id ORDER BY equipment_code');
    $query->execute(['company_id' => $user['company_id']]);
    json_response(['data' => $query->fetchAll()]);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['error' => 'Método não permitido.'], 405);
require_csrf();
if (!in_array($user['role'], ['ADMIN_DALLOGIX', 'ADMIN_EMPRESA'], true)) json_response(['error' => 'Perfil sem permissão para cadastrar Dala.'], 403);

$payload = request_json();
$code = trim((string) ($payload['equipment_code'] ?? ''));
$name = trim((string) ($payload['name'] ?? ''));
$ip = trim((string) ($payload['plc_ip'] ?? ''));
$port = filter_var($payload['plc_port'] ?? 502, FILTER_VALIDATE_INT);
$externalPort = ($payload['external_port'] ?? '') === '' ? null : filter_var($payload['external_port'], FILTER_VALIDATE_INT);
$protocol = strtoupper(trim((string) ($payload['plc_protocol'] ?? 'MODBUS_TCP')));
if ($code === '' || $name === '' || $ip === '' || !in_array($protocol, ['MODBUS_TCP', 'MODBUS_RTU'], true) || $port === false || $port < 1 || $port > 65535 || ($externalPort !== null && ($externalPort === false || $externalPort < 1 || $externalPort > 65535))) json_response(['error' => 'Dados da Dala ou comunicação inválidos.'], 422);

try {
    $insert = $pdo->prepare('INSERT INTO equipments (company_id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol) VALUES (:company_id, :equipment_code, :name, :plc_ip, :plc_port, :external_port, :plc_protocol)');
    $insert->execute(['company_id' => $user['company_id'], 'equipment_code' => $code, 'name' => $name, 'plc_ip' => $ip, 'plc_port' => $port, 'external_port' => $externalPort, 'plc_protocol' => $protocol]);
    $id = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $user, 'DALA_CADASTRADA', 'equipment', $id, ['equipment_code' => $code, 'plc_protocol' => $protocol]);
    json_response(['data' => ['id' => $id, 'equipment_code' => $code]], 201);
} catch (Throwable $exception) {
    json_response(['error' => 'Identificador da Dala já cadastrado.'], 409);
}
