<?php

declare(strict_types=1);

use App\Aplicacao\ServicoLeituras;
use App\Persistencia\RepositorioLeituras;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioLeituras.php";
require_once __DIR__ . "/../../servidor/src/Aplicacao/ServicoLeituras.php";

final class ServicoLeiturasTest extends TestCase
{
    public function testPendenciasSaoPaginadasEFiltradasPorEmpresaECarregamento(): void
    {
        $service = new ServicoLeituras(new RepositorioLeituras($this->criarBancoDeTeste()));

        $secondPage = $service->listarPendentes(7, 12, 2);
        self::assertSame([
            "page" => 2,
            "per_page" => 20,
            "total" => 45,
            "pages" => 3,
        ], $secondPage["pagination"]);
        self::assertCount(20, $secondPage["data"]);
        self::assertSame(25, (int) $secondPage["data"][0]["id"]);
        self::assertSame(6, (int) $secondPage["data"][19]["id"]);

        $lastPage = $service->listarPendentes(7, 12, 999);
        self::assertSame(3, $lastPage["pagination"]["page"]);
        self::assertCount(5, $lastPage["data"]);
        self::assertSame(5, (int) $lastPage["data"][0]["id"]);
    }

    public function testLimitaTamanhoMaximoDaPagina(): void
    {
        $service = new ServicoLeituras(new RepositorioLeituras($this->criarBancoDeTeste()));

        $result = $service->listarPendentes(7, 12, 1, 1000);

        self::assertSame(100, $result["pagination"]["per_page"]);
        self::assertCount(45, $result["data"]);
    }

    private function criarBancoDeTeste(): PDO
    {
        $pdo = new PDO("sqlite::memory:", null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $pdo->exec("CREATE TABLE carregamentos (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL
        )");
        $pdo->exec("CREATE TABLE leituras (
            id INTEGER PRIMARY KEY,
            company_id INTEGER NOT NULL,
            carregamento_id INTEGER NOT NULL,
            read_at TEXT NOT NULL,
            result TEXT NOT NULL
        )");
        $pdo->exec("INSERT INTO carregamentos VALUES (12, 7), (13, 8), (14, 7)");

        $insert = $pdo->prepare(
            "INSERT INTO leituras (id, company_id, carregamento_id, read_at, result)
             VALUES (:id, :company_id, :loading_id, '2026-10-19 10:00:00', :result)",
        );
        for ($id = 1; $id <= 45; $id++) {
            $insert->execute([
                "id" => $id,
                "company_id" => 7,
                "loading_id" => 12,
                "result" => "SEM_LEITURA",
            ]);
        }
        $insert->execute([
            "id" => 46,
            "company_id" => 7,
            "loading_id" => 12,
            "result" => "VALIDO",
        ]);
        $insert->execute([
            "id" => 47,
            "company_id" => 8,
            "loading_id" => 13,
            "result" => "SEM_LEITURA",
        ]);
        $insert->execute([
            "id" => 48,
            "company_id" => 7,
            "loading_id" => 14,
            "result" => "SEM_LEITURA",
        ]);

        return $pdo;
    }
}
