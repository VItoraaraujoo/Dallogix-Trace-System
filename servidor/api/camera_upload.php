<?php
declare(strict_types=1);

define("TRACE_SKIP_SESSION", true);

require_once __DIR__ . '/../configuracao/bootstrap.php';
require_once __DIR__ . '/../../scripts/image_storage_path.php';
require_once __DIR__ . '/../src/Aplicacao/RelatorioAuditoriaPdf.php';

use App\Aplicacao\RelatorioAuditoriaPdf;

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
$mime = is_string($mime) ? $mime : '';
if (!in_array($mime, ['image/jpeg', 'image/png'], true)) {
    json_response(['error' => 'A evidência deve ser JPEG ou PNG.'], 422);
}

$pdo = db();
$claim = $pdo->prepare(
    "SELECT r.id, r.equipment_id, r.reason, r.evidence_pdf_path, c.company_id
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
if (!$request = $claim->fetch()) {
    json_response(['error' => 'Pedido não reservado por esta câmera.'], 404);
}

$imageData = file_get_contents($upload['tmp_name']);
if (!is_string($imageData) || strlen($imageData) !== $bytes) {
    json_response(['error' => 'Não foi possível ler a imagem recebida.'], 422);
}
$evidence = new RelatorioAuditoriaPdf('Dallogix Trace', 'Evidência da câmera');
$evidence->heading('Evidência da câmera');
if (!$evidence->incidentImageData($imageData, $mime, 'Ocorrência: ' . (string) $request['reason'], true)) {
    json_response(['error' => 'A imagem está inválida ou excede os limites de processamento do PDF.'], 422);
}
$pdfBytes = $evidence->output();
$sha256 = hash('sha256', $pdfBytes);

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
$filename = 'capture-' . $requestId . '-' . $sha256 . '.pdf';
$destination = $resolvedFolder . DIRECTORY_SEPARATOR . $filename;
$storedPdfPath = $relativeFolder . '/' . $filename;
if (is_string($request['evidence_pdf_path'] ?? null) && $request['evidence_pdf_path'] !== $storedPdfPath) {
    json_response(['error' => 'Esta captura já recebeu outro PDF de evidência.'], 409);
}
$alreadyStored = is_file($destination);
if ($alreadyStored && hash_file('sha256', $destination) !== $sha256) {
    json_response(['error' => 'Nome de evidência PDF já ocupado por outro arquivo.'], 409);
}
if (!$alreadyStored) {
    $temporary = $destination . '.tmp-' . bin2hex(random_bytes(8));
    if (file_put_contents($temporary, $pdfBytes, LOCK_EX) !== strlen($pdfBytes)
        || !chmod($temporary, 0600) || !rename($temporary, $destination)) {
        if (is_file($temporary)) {
            unlink($temporary);
        }
        json_response(['error' => 'Falha ao guardar o PDF de evidência.'], 503);
    }
}
if (trace_camera_evidence_pdf_path($storageRoot, (int) $device['company_id'],
    (int) $device['equipment_id'], (int) $requestId, $storedPdfPath) === null) {
    if (!$alreadyStored) {
        unlink($destination);
    }
    json_response(['error' => 'O PDF de evidência não pôde ser validado.'], 422);
}
try {
    $savePath = $pdo->prepare(
        "UPDATE solicitacoes_captura_camera
         SET evidence_pdf_path = :evidence_pdf_path
         WHERE id = :id AND claimed_by_device_id = :device_id AND status = 'CAPTURANDO'
           AND (evidence_pdf_path IS NULL OR evidence_pdf_path = :same_path)",
    );
    $savePath->execute([
        'evidence_pdf_path' => $storedPdfPath,
        'id' => $requestId,
        'device_id' => $device['id'],
        'same_path' => $storedPdfPath,
    ]);
    $confirmPath = $pdo->prepare(
        "SELECT evidence_pdf_path FROM solicitacoes_captura_camera
         WHERE id = :id AND claimed_by_device_id = :device_id AND status = 'CAPTURANDO'",
    );
    $confirmPath->execute(['id' => $requestId, 'device_id' => $device['id']]);
    if ($confirmPath->fetchColumn() !== $storedPdfPath) {
        throw new RuntimeException('O caminho do PDF não foi confirmado pela solicitação de captura.');
    }
} catch (Throwable $exception) {
    if (!$alreadyStored && is_file($destination)) {
        unlink($destination);
    }
    json_response(['error' => 'Não foi possível vincular o PDF à solicitação de captura.'], 503);
}
json_response(['data' => [
    'request_id' => (int) $requestId,
    'evidence_pdf_path' => $storedPdfPath,
    'source_bytes' => $bytes,
    'pdf_bytes' => strlen($pdfBytes),
    'source_sha256' => hash('sha256', $imageData),
    'pdf_sha256' => $sha256,
]], 201);
