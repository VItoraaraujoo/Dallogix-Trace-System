<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$host = getenv('DB_HOST') ?: '127.0.0.1';
$name = getenv('DB_NAME') ?: 'trace_local';
$user = getenv('DB_USER') ?: 'trace';
$password = getenv('DB_PASSWORD') ?: 'change-me-local';
$days = max(1, (int) (getenv('IMAGE_RETENTION_DAYS') ?: 30));
$pdo = new PDO("mysql:host={$host};dbname={$name};charset=utf8mb4", $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$statement = $pdo->query('SELECT id, path FROM imagens WHERE captured_at < DATE_SUB(NOW(), INTERVAL ' . $days . ' DAY)');
$statement->execute();
$removed = 0;
foreach ($statement->fetchAll(PDO::FETCH_ASSOC) as $image) {
    $path = (string) $image['path'];
    $absolutePath = str_starts_with($path, '/') ? $path : $root . '/' . ltrim($path, '/');
    if (str_starts_with($absolutePath, $root . '/storage/') && is_file($absolutePath)) @unlink($absolutePath);
    $delete = $pdo->prepare('DELETE FROM imagens WHERE id = :id');
    $delete->execute(['id' => $image['id']]);
    $removed++;
}
echo "Removed {$removed} image records older than {$days} days.\n";
