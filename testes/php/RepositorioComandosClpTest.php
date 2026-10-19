<?php

declare(strict_types=1);

use App\Persistencia\RepositorioComandosClp;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioComandosClp.php";

final class RepositorioComandosClpTest extends TestCase
{
    public function testEmergenciaSoAtualizaCarregamentoDaEmpresaNoEstadoEsperado(): void
    {
        $connection = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $connection->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            state TEXT NOT NULL
        )");
        $connection->exec("INSERT INTO carregamentos VALUES
            (1, 10, 'CARREGANDO'),
            (2, 20, 'CARREGANDO'),
            (3, 10, 'EMERGENCIA')");
        $repository = new RepositorioComandosClp($connection);

        self::assertTrue($repository->alterarEstadoParaEmergencia(1, 10, "CARREGANDO"));
        self::assertFalse($repository->alterarEstadoParaEmergencia(1, 10, "CARREGANDO"));
        self::assertFalse($repository->alterarEstadoParaEmergencia(2, 10, "CARREGANDO"));
        self::assertFalse($repository->alterarEstadoParaEmergencia(3, 10, "CARREGANDO"));
        self::assertSame(
            "EMERGENCIA",
            $connection->query("SELECT state FROM carregamentos WHERE id = 1")->fetchColumn(),
        );
        self::assertSame(
            "CARREGANDO",
            $connection->query("SELECT state FROM carregamentos WHERE id = 2")->fetchColumn(),
        );
    }
}
