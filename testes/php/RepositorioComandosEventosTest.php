<?php

declare(strict_types=1);

use App\Persistencia\RepositorioComandosEventos;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioComandosEventos.php";

final class RepositorioComandosEventosTest extends TestCase
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
        $connection->exec("CREATE TABLE solicitacoes_comandos_clp (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, equipment_id INTEGER NOT NULL,
            status TEXT NOT NULL, completed_at TEXT NULL, response_message TEXT NULL
        )");
        return $connection;
    }

    public function testRetornoAtualizaApenasComandoDaEmpresaEDalaVinculadas(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO solicitacoes_comandos_clp VALUES
            (11, 3, 7, 'PROCESSANDO', NULL, NULL),
            (12, 3, 8, 'PROCESSANDO', NULL, NULL),
            (13, 9, 7, 'PROCESSANDO', NULL, NULL)");

        (new RepositorioComandosEventos($connection))->registrarRetorno(3, 7, 11, "APLICADO", "Eco confirmado");

        self::assertSame("APLICADO", $connection->query("SELECT status FROM solicitacoes_comandos_clp WHERE id = 11")->fetchColumn());
        self::assertSame("2026-10-19 12:00:00", $connection->query("SELECT completed_at FROM solicitacoes_comandos_clp WHERE id = 11")->fetchColumn());
        self::assertSame("Eco confirmado", $connection->query("SELECT response_message FROM solicitacoes_comandos_clp WHERE id = 11")->fetchColumn());
        self::assertSame("PROCESSANDO", $connection->query("SELECT status FROM solicitacoes_comandos_clp WHERE id = 12")->fetchColumn());
        self::assertSame("PROCESSANDO", $connection->query("SELECT status FROM solicitacoes_comandos_clp WHERE id = 13")->fetchColumn());
    }
}
