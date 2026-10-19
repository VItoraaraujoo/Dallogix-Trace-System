<?php

declare(strict_types=1);

use App\Persistencia\RepositorioStatusSincronizacao;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioStatusSincronizacao.php";

final class RepositorioStatusSincronizacaoTest extends TestCase
{
    public function testResumeContagensEIdadeDaFilaEmUmaConsultaEscopadaPorEmpresa(): void
    {
        $pdo = $this->createDatabase();
        $pdo->exec("INSERT INTO fila_sincronizacao VALUES
            (1, 5, 'PENDENTE', '2026-10-19 08:00:00'),
            (2, 5, 'PENDENTE', '2026-10-19 09:00:00'),
            (3, 5, 'PROCESSANDO', '2026-10-19 08:30:00'),
            (4, 5, 'ERRO', '2026-10-19 08:15:00'),
            (5, 5, 'ENVIADO', '2026-10-19 07:00:00'),
            (6, 5, 'NOVO_STATUS', '2026-10-19 06:00:00'),
            (7, 6, 'PENDENTE', '2026-10-18 00:00:00')");

        $result = (new RepositorioStatusSincronizacao($pdo))->obterResumoFila(5);

        self::assertSame([
            "PENDENTE" => 2,
            "PROCESSANDO" => 1,
            "ENVIADO" => 1,
            "ERRO" => 1,
            "NOVO_STATUS" => 1,
        ], $result["summary"]);
        self::assertSame("2026-10-19 08:00:00", $result["oldest_at"]);
    }

    public function testEmpresaSemFilaRetornaContagensZeroEDataNula(): void
    {
        $pdo = $this->createDatabase();

        $result = (new RepositorioStatusSincronizacao($pdo))->obterResumoFila(5);

        self::assertSame([
            "PENDENTE" => 0,
            "PROCESSANDO" => 0,
            "ENVIADO" => 0,
            "ERRO" => 0,
        ], $result["summary"]);
        self::assertNull($result["oldest_at"]);
    }

    private function createDatabase(): PDO
    {
        $pdoClass = class_exists("Pdo\\Sqlite") ? "Pdo\\Sqlite" : PDO::class;
        $pdo = new $pdoClass("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec(
            "CREATE TABLE fila_sincronizacao (
                id INTEGER PRIMARY KEY,
                company_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
        );

        return $pdo;
    }
}
