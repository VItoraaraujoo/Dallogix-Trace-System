<?php
declare(strict_types=1);

require_once __DIR__ . '/../configuracao/bootstrap.php';
require_once __DIR__ . '/../../scripts/image_storage_path.php';

exigir_metodo_http(['POST']);
$device = require_device_token(['CAMERA']);
$requestId = filter_var($_POST['request_id'] ?? null, FILTER_VALIDATE_INT);
$upload = $_FILES['file'] ?? null;
if (!$requestId || !is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
    || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) {
    json_response(['error' => 'Envie request_id e uma imagem da câmera.'], 422);
}
$bytes = filesize($upload['tmp_name']);
if ($bytes === false || $bytes < 1 || $bytes > 5 * 1024 * 1024) {
    json_response(['error' => 'Imagem vazia ou acima de 5 MB.'], 413);
}
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($upload['tmp_name']);
$extension = match ($mime) {
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    default => null,
};
if ($extension === null) {
    json_response(['error' => 'A evidência deve ser JPEG ou PNG.'], 422);
}

$pdo = db();
$claim = $pdo->prepare(
    "SELECT r.id, r.equipment_id, c.company_id
     FROM solicitacoes_captura_camera r
     JOIN carregamentos c ON c.id = r.carregamento_id
     WHERE r.id = :request_id AND r.equipment_id = :equipment_id
       AND c.company_id = :company_id
       AND r.claimed_by_device_id = :device_id AND r.status = 'CAPTURANDO'
     LIMIT 1",
);
$claim->execute([
    'request_id' => $requestId,
    'equipment_id' => $device['equipment_id'],
    'company_id' => $device['company_id'],
    'device_id' => $device['id'],
]);
if (!$claim->fetch()) {
    json_response(['error' => 'Pedido não reservado por esta câmera.'], 404);
}

$storageRoot = realpath(__DIR__ . '/../../armazenamento');
if ($storageRoot === false) {
    json_response(['error' => 'Armazenamento de evidências indisponível.'], 503);
}
$relativeFolder = 'company_' . (int) $device['company_id'] . '/equipment_' . (int) $device['equipment_id'];
$folder = $storageRoot . '/' . $relativeFolder;
if (!is_dir($folder) && !mkdir($folder, 0700, true) && !is_dir($folder)) {
    json_response(['error' => 'Não foi possível preparar a pasta de evidências.'], 503);
}
$resolvedFolder = realpath($folder);
if ($resolvedFolder === false || !str_starts_with($resolvedFolder, $storageRoot . DIRECTORY_SEPARATOR)) {
    json_response(['error' => 'Pasta de evidências inválida.'], 503);
}
$sha256 = hash_file('sha256', $upload['tmp_name']);
if ($sha256 === false) {
    json_response(['error' => 'Não foi possível verificar a imagem enviada.'], 422);
}
$filename = 'capture-' . $requestId . '-' . $sha256 . '.' . $extension;
$destination = $resolvedFolder . DIRECTORY_SEPARATOR . $filename;
$alreadyStored = is_file($destination);
if ($alreadyStored && hash_file('sha256', $destination) !== $sha256) {
    json_response(['error' => 'Nome de evidência já ocupado por outro arquivo.'], 409);
}
if (!$alreadyStored && !move_uploaded_file($upload['tmp_name'], $destination)) {
    json_response(['error' => 'Falha ao guardar a imagem da câmera.'], 503);
}
if (!$alreadyStored && !chmod($destination, 0600)) {
    unlink($destination);
    json_response(['error' => 'Falha ao proteger a imagem da câmera.'], 503);
}
$storedPath = $relativeFolder . '/' . $filename;
if (trace_camera_evidence_path($storageRoot, (int) $device['company_id'],
    (int) $device['equipment_id'], (int) $requestId, $storedPath) === null) {
    if (!$alreadyStored) {
        unlink($destination);
    }
    json_response(['error' => 'A imagem enviada não pôde ser validada.'], 422);
}
json_response(['data' => [
    'request_id' => (int) $requestId,
    'image_path' => $storedPath,
    'bytes' => $bytes,
    'sha256' => $sha256,
]], 201);
