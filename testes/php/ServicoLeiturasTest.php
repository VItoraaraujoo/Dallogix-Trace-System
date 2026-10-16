<?php
declare(strict_types=1);

require_once __DIR__ . '/../../servidor/src/Aplicacao/ServicoLeituras.php';

use App\Aplicacao\ServicoLeituras;
use PHPUnit\Framework\TestCase;

final class ServicoLeiturasTest extends TestCase
{
    public function testPendenciasSaoPaginadasComTotalEConsistenciaDePagina(): void
    {
        $connection = new LeiturasPdoFake(45);
        $service = new ServicoLeituras($connection);
        $secondPage = $service->listarPendentes(7, 12, 2);
        self::assertSame([
            "page" => 2, "per_page" => 20, "total" => 45, "pages" => 3,
        ], $secondPage["pagination"]);
        self::assertCount(1, $secondPage["data"]);
        self::assertStringContainsString("LIMIT 20 OFFSET 20", $connection->lastListQuery);

        $lastPage = $service->listarPendentes(7, 12, 999);
        self::assertSame(3, $lastPage["pagination"]["page"]);
        self::assertStringContainsString("LIMIT 20 OFFSET 40", $connection->lastListQuery);
    }
}

final class LeiturasPdoFake extends PDO
{
    public string $lastListQuery = "";

    public function __construct(private readonly int $total)
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        if (str_contains($query, "COUNT(*)")) {
            return new LeiturasStatementFake($this->total, []);
        }
        $this->lastListQuery = $query;
        return new LeiturasStatementFake(0, [["id" => 1, "result" => "SEM_LEITURA"]]);
    }
}

final class LeiturasStatementFake extends PDOStatement
{
    public function __construct(private readonly int $total, private readonly array $rows)
    {
    }

    public function execute(?array $params = null): bool
    {
        return true;
    }

    public function fetchColumn(int $column = 0): mixed
    {
        return $this->total;
    }

    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        return $this->rows;
    }
}
