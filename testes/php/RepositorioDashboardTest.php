<?php

declare(strict_types=1);

use App\Persistencia\RepositorioDashboard;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioDashboard.php";

final class RepositorioDashboardTest extends TestCase
{
    public function testContaApenasRomaneiosFinalizadosDaEmpresaComDivergencia(): void
    {
        $repository = new RepositorioDashboard($this->createDatabase());

        self::assertSame(2, $repository->contarRomaneiosDivergentes(10));
        self::assertSame(0, $repository->contarRomaneiosDivergentes(30));
    }

    private function createDatabase(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE romaneios (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, status TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE romaneio_itens (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL,
            romaneio_id INTEGER NOT NULL, planned_quantity INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, romaneio_id INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL,
            carregamento_id INTEGER NOT NULL, result TEXT NOT NULL
        )");
        $pdo->exec("CREATE TABLE ocorrencias (
            id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, carregamento_id INTEGER NOT NULL
        )");

        $pdo->exec("INSERT INTO romaneios VALUES
            (1, 10, 'FINALIZADO'),
            (2, 10, 'FINALIZADO'),
            (3, 10, 'EM_ANDAMENTO'),
            (4, 20, 'FINALIZADO')");
        $pdo->exec("INSERT INTO romaneio_itens VALUES
            (1, 10, 1, 3), (2, 10, 2, 1), (3, 10, 3, 50), (4, 20, 4, 1)");
        $pdo->exec("INSERT INTO carregamentos VALUES
            (101, 10, 1), (102, 10, 2), (103, 10, 3), (201, 20, 4)");
        $pdo->exec("INSERT INTO leituras VALUES
            (1, 10, 101, 'VALIDO'), (2, 10, 101, 'VALIDO'),
            (3, 10, 102, 'VALIDO'), (4, 10, 102, 'INVALIDO'),
            (5, 10, 103, 'VALIDO'), (6, 20, 201, 'VALIDO'),
            (7, 20, 201, 'VALIDO'), (8, 20, 201, 'VALIDO')");
        $pdo->exec("INSERT INTO ocorrencias VALUES (1, 10, 102), (2, 20, 201)");

        return $pdo;
    }
}
