<?php
declare(strict_types=1);

/** Resolve somente arquivos existentes dentro do armazenamento de evidências. */
function trace_image_storage_path(string $storageDirectory, string $storedPath): ?string
{
    $storageRoot = realpath($storageDirectory);
    if ($storageRoot === false || trim($storedPath) === '') {
        return null;
    }
    $relative = ltrim($storedPath, '/');
    if (str_starts_with($relative, 'armazenamento/')) {
        $relative = substr($relative, strlen('armazenamento/'));
    }
    $candidate = str_starts_with($storedPath, '/')
        ? $storedPath
        : $storageRoot . DIRECTORY_SEPARATOR . $relative;
    $resolved = realpath($candidate);
    if ($resolved === false || !str_starts_with($resolved, $storageRoot . DIRECTORY_SEPARATOR) || !is_file($resolved)) {
        return null;
    }
    return $resolved;
}

/** Confirma que a evidência enviada pertence exatamente à solicitação reservada. */
function trace_camera_evidence_path(
    string $storageDirectory,
    int $companyId,
    int $equipmentId,
    int $requestId,
    string $storedPath,
): ?string {
    $prefix = "company_{$companyId}/equipment_{$equipmentId}/";
    if (!str_starts_with($storedPath, $prefix)) {
        return null;
    }
    $basename = substr($storedPath, strlen($prefix));
    if (preg_match('/\Acapture-' . $requestId . '-[a-f0-9]{64}\.(jpg|png)\z/', $basename) !== 1) {
        return null;
    }
    $resolved = trace_image_storage_path($storageDirectory, $storedPath);
    if ($resolved === null) {
        return null;
    }
    $size = filesize($resolved);
    if ($size === false || $size < 1 || $size > 5 * 1024 * 1024) {
        return null;
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($resolved);
    $expectedMime = str_ends_with($basename, '.jpg') ? 'image/jpeg' : 'image/png';
    if ($mime !== $expectedMime) {
        return null;
    }
    $expectedHash = substr($basename, strlen('capture-' . $requestId . '-'), 64);
    if (hash_file('sha256', $resolved) !== $expectedHash) {
        return null;
    }
    try {
        $dimensions = getimagesize($resolved);
    } catch (Throwable) {
        return null;
    }
    if ($dimensions === false || $dimensions[0] < 1 || $dimensions[1] < 1
        || $dimensions[0] > 10000 || $dimensions[1] > 10000) {
        return null;
    }
    return $resolved;
}
