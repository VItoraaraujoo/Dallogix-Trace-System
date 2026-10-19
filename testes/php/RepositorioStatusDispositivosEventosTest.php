<?php

declare(strict_types=1);

use App\Persistencia\RepositorioStatusDispositivosEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioStatusDispositivosEventos.php";

final class RepositorioStatusDispositivosEventosTest extends TestCase
{
    private function database(): PDO
    {
        if (class_exists("Pdo\\Sqlite")) {
            $connection = new \Pdo\Sqlite("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $connection->createFunction("NOW", static fn (...$arguments): string => "2026-10-19 12:00:00", -1);
        } else {
            $connection = new PDO("sqlite::memory:", null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $connection->sqliteCreateFunction("NOW", static fn (...$arguments): string => "2026-10-19 12:00:00", -1);
        }
        $connection->exec("CREATE TABLE status_dispositivos (
            equipment_id INTEGER NOT NULL, device_type TEXT NOT NULL, status TEXT NOT NULL,
            last_seen_at TEXT NULL, details TEXT NULL,
            UNIQUE(equipment_id, device_type)
        )");
        return $connection;
    }

    public function testNovoStatusCriaRegistroEAtualizacoesSubstituemOSnapshot(): void
    {
        $connection = $this->database();
        $repository = new RepositorioStatusDispositivosEventos($connection);
        $repository->registrar(7, "CLP", "OFFLINE", '{"source":"instalacao_local"}');
        $repository->registrar(7, "CLP", "ONLINE", '{"source":"instalacao_local","fresh":true}');

        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM status_dispositivos")->fetchColumn());
        self::assertSame("ONLINE", $connection->query("SELECT status FROM status_dispositivos WHERE equipment_id = 7 AND device_type = 'CLP'")->fetchColumn());
        self::assertSame("2026-10-19 12:00:00", $connection->query("SELECT last_seen_at FROM status_dispositivos")->fetchColumn());
        self::assertSame('{"source":"instalacao_local","fresh":true}', $connection->query("SELECT details FROM status_dispositivos")->fetchColumn());
    }
}
