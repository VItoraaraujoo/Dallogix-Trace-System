<?php

declare(strict_types=1);

use App\Persistencia\RepositorioFilaSincronizacao;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioFilaSincronizacao.php";

final class RepositorioFilaSincronizacaoTest extends TestCase
{
    public function testRetornaUmDestinoPorEmpresaComPendenciasDisponiveis(): void
    {
        $pdo = $this->createDatabase();
        $pdo->exec("INSERT INTO configuracoes_empresa (company_id, sync_remote_url) VALUES
            (5, 'https://central.example/api'),
            (6, 'https://outra.example/api'),
            (7, '   ')");
        $pdo->exec("INSERT INTO fila_sincronizacao (company_id, status, available_at) VALUES
            (5, 'PENDENTE', NULL),
            (5, 'ERRO', datetime('now', '-1 hour')),
            (5, 'PROCESSANDO', NULL),
            (5, 'ENVIADO', NULL),
            (6, 'PENDENTE', datetime('now', '+1 hour')),
            (7, 'PENDENTE', NULL)");

        $destinations = (new RepositorioFilaSincronizacao($pdo))->destinosRemotosDisponiveis();

        self::assertSame([
            ["company_id" => 5, "sync_remote_url" => "https://central.example/api"],
        ], $destinations);
    }

    public function testBuscaUrlRemotaDaEmpresaComValorNormalizado(): void
    {
        $pdo = $this->createDatabase();
        $pdo->exec("INSERT INTO configuracoes_empresa (company_id, sync_remote_url) VALUES
            (5, '  https://central.example/api  '),
            (6, '   ')");
        $repository = new RepositorioFilaSincronizacao($pdo);

        self::assertSame("https://central.example/api", $repository->urlRemotaDaEmpresa(5));
        self::assertSame("", $repository->urlRemotaDaEmpresa(6));
        self::assertSame("", $repository->urlRemotaDaEmpresa(7));
    }

    private function createDatabase(): PDO
    {
        $pdoClass = class_exists("Pdo\\Sqlite") ? "Pdo\\Sqlite" : PDO::class;
        $pdo = new $pdoClass("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE fila_sincronizacao (
            company_id INTEGER NOT NULL,
            status TEXT NOT NULL,
            available_at TEXT NULL
        )");
        $pdo->exec("CREATE TABLE configuracoes_empresa (
            company_id INTEGER PRIMARY KEY,
            sync_remote_url TEXT NULL
        )");

        return $pdo;
    }
}
