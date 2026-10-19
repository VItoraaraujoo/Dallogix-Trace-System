<?php

declare(strict_types=1);

use App\Aplicacao\ExcecaoDisponibilidadeClp;
use App\Aplicacao\ServicoDisponibilidadeClp;
use App\Persistencia\RepositorioDisponibilidadeClp;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Aplicacao/ServicoDisponibilidadeClp.php";

final class ServicoDisponibilidadeClpTest extends TestCase
{
    private string|false $limiteAnterior;

    protected function setUp(): void
    {
        $this->limiteAnterior = getenv("CLP_SIGNAL_LIMIT_SECONDS");
        putenv("CLP_SIGNAL_LIMIT_SECONDS=3");
    }

    protected function tearDown(): void
    {
        if ($this->limiteAnterior === false) {
            putenv("CLP_SIGNAL_LIMIT_SECONDS");
            return;
        }
        putenv("CLP_SIGNAL_LIMIT_SECONDS={$this->limiteAnterior}");
    }

    public function testPermiteComandoQuandoHeartbeatOnlineEstaNoLimite(): void
    {
        $connection = new DisponibilidadeClpPdoFake([
            "status" => "ONLINE",
            "last_seen_at" => "2026-10-19 12:00:00",
            "segundos_sem_sinal" => 3,
        ]);

        (new ServicoDisponibilidadeClp(new RepositorioDisponibilidadeClp($connection)))
            ->validarComando(7, 12);

        self::assertSame([
            "equipment_id" => 12,
            "company_id" => 7,
        ], $connection->parameters);
        self::assertStringContainsString("e.company_id = :company_id", $connection->query);
        self::assertStringContainsString("d.device_type = 'CLP'", $connection->query);
    }

    public function testBloqueiaHeartbeatOnlineAlemDoLimite(): void
    {
        $service = $this->criarServico([
            "status" => "ONLINE",
            "last_seen_at" => "2026-10-19 11:59:56",
            "segundos_sem_sinal" => 4,
        ]);

        $this->expectException(ExcecaoDisponibilidadeClp::class);
        $service->validarComando(7, 12);
    }

    public function testBloqueiaEstadoOfflineMesmoComHeartbeatRecente(): void
    {
        $service = $this->criarServico([
            "status" => "OFFLINE",
            "last_seen_at" => "2026-10-19 12:00:00",
            "segundos_sem_sinal" => 0,
        ]);

        $this->expectException(ExcecaoDisponibilidadeClp::class);
        $service->validarComando(7, 12);
    }

    public function testBloqueiaAusenciaDeHeartbeat(): void
    {
        $service = $this->criarServico(null);

        $this->expectException(ExcecaoDisponibilidadeClp::class);
        $service->validarComando(7, 12);
    }

    public function testBloqueiaHeartbeatSemData(): void
    {
        $service = $this->criarServico([
            "status" => "ONLINE",
            "last_seen_at" => null,
            "segundos_sem_sinal" => 0,
        ]);

        $this->expectException(ExcecaoDisponibilidadeClp::class);
        $service->validarComando(7, 12);
    }

    /** @param array{status:string,last_seen_at:string|null,segundos_sem_sinal:int|string|null}|null $row */
    private function criarServico(?array $row): ServicoDisponibilidadeClp
    {
        return new ServicoDisponibilidadeClp(
            new RepositorioDisponibilidadeClp(new DisponibilidadeClpPdoFake($row)),
        );
    }
}

final class DisponibilidadeClpPdoFake extends PDO
{
    public string $query = "";

    /** @var array<string,int|string> */
    public array $parameters = [];

    /** @param array{status:string,last_seen_at:string|null,segundos_sem_sinal:int|string|null}|null $row */
    public function __construct(private readonly ?array $row)
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        $this->query = $query;

        return new DisponibilidadeClpStatementFake($this, $this->row);
    }
}

final class DisponibilidadeClpStatementFake extends PDOStatement
{
    /** @param array{status:string,last_seen_at:string|null,segundos_sem_sinal:int|string|null}|null $row */
    public function __construct(
        private readonly DisponibilidadeClpPdoFake $connection,
        private readonly ?array $row,
    ) {
    }

    public function execute(?array $params = null): bool
    {
        $this->connection->parameters = $params ?? [];

        return true;
    }

    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed
    {
        return $this->row ?? false;
    }
}
