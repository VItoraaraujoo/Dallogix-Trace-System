<?php

declare(strict_types=1);

use App\Aplicacao\ServicoComandoClp;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../servidor/src/Aplicacao/ServicoDisponibilidadeClp.php';
require_once __DIR__ . '/../../servidor/src/Aplicacao/ServicoComandoClp.php';

final class ServicoComandoClpPdoFake extends PDO
{
    /** @var list<array<string,mixed>> */
    public array $solicitacoes = [];

    /** @var list<array<string,mixed>> */
    public array $eventos = [];

    /** @var list<array{sql:string,params:array<string,mixed>}> */
    public array $consultas = [];

    /** @var array<string,mixed> */
    public array $carregamento = [
        'id' => 17,
        'state' => 'PREPARANDO',
        'equipment_id' => 23,
        'remote_carregamento_id' => null,
        'stop_reason' => null,
        'operator_alert' => null,
    ];

    /** @var array{id:int|string,status:string,command:string}|false */
    public array|false $comandoPendente = false;

    /** @var list<array<string,mixed>> */
    public array $comandosCancelados = [];

    public ?string $ultimaReversao = 'REVERSAO_DESATIVAR';

    private bool $emTransacao = false;

    public function __construct()
    {
    }

    public function prepare(string $query, array $options = []): PDOStatement|false
    {
        return new ServicoComandoClpStatementFake($this, $query);
    }

    public function beginTransaction(): bool
    {
        $this->emTransacao = true;
        return true;
    }

    public function commit(): bool
    {
        $this->emTransacao = false;
        return true;
    }

    public function rollBack(): bool
    {
        $this->emTransacao = false;
        return true;
    }

    public function inTransaction(): bool
    {
        return $this->emTransacao;
    }

    public function lastInsertId(?string $name = null): string|false
    {
        return '501';
    }
}

final class ServicoComandoClpStatementFake extends PDOStatement
{
    /** @var array<string,mixed> */
    private array $params = [];

    public function __construct(
        private readonly ServicoComandoClpPdoFake $connection,
        private readonly string $query,
    ) {
    }

    public function execute(?array $params = null): bool
    {
        $this->params = $params ?? [];
        $this->connection->consultas[] = ['sql' => $this->query, 'params' => $this->params];
        if (str_contains($this->query, 'INSERT INTO solicitacoes_comandos_clp')) {
            $this->connection->solicitacoes[] = $this->params;
        }
        if (
            str_contains($this->query, "SET status = 'REJEITADO'")
            && str_contains($this->query, 'response_message = :message')
        ) {
            $this->connection->comandosCancelados[] = $this->params;
        }
        if (str_contains($this->query, 'INSERT INTO logs_auditoria')) {
            $metadata = json_decode((string) ($this->params['metadata'] ?? '{}'), true);
            $this->connection->eventos[] = [
                'action' => $this->params['action'] ?? null,
                'entity_type' => $this->params['entity_type'] ?? null,
                'entity_id' => $this->params['entity_id'] ?? null,
                'payload' => is_array($metadata) ? $metadata : [],
            ];
        }
        return true;
    }

    public function fetch(int $mode = PDO::FETCH_DEFAULT, int $orientation = PDO::FETCH_ORI_NEXT, int $offset = 0): mixed
    {
        if (str_contains($this->query, 'FROM carregamentos WHERE id = :id')) {
            return $this->connection->carregamento;
        }
        if (str_contains($this->query, 'SELECT id, status, command FROM solicitacoes_comandos_clp')) {
            return $this->connection->comandoPendente;
        }
        if (str_contains($this->query, "SELECT d.status, d.last_seen_at")) {
            return ['status' => 'ONLINE', 'last_seen_at' => '2026-10-19 12:00:00', 'segundos_sem_sinal' => 0];
        }
        return false;
    }

    public function fetchColumn(int $column = 0): mixed
    {
        return str_contains($this->query, "command IN ('REVERSAO_ATIVAR'")
            ? $this->connection->ultimaReversao
            : false;
    }

    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array
    {
        return [];
    }

    public function rowCount(): int
    {
        return 1;
    }
}

if (!function_exists('record_operational_event')) {
    function record_operational_event(
        PDO $connection,
        array $user,
        string $action,
        string $entityType,
        int $entityId,
        array $payload = [],
    ): void {
        if ($connection instanceof ServicoComandoClpPdoFake) {
            $connection->eventos[] = [
                'user' => $user,
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'payload' => $payload,
            ];
        }
    }
}

final class ServicoComandoClpTest extends TestCase
{
    /** @return array{id:int,company_id:int} */
    private function usuario(): array
    {
        return ['id' => 5, 'company_id' => 2];
    }

    public function testOperacaoRegistraComandoEEventoDeAuditoria(): void
    {
        $connection = new ServicoComandoClpPdoFake();

        $result = (new ServicoComandoClp($connection))->solicitarOperacao(
            $this->usuario(),
            17,
            'PAUSAR_CARREGAMENTO',
        );

        self::assertSame('PAUSAR_CARREGAMENTO', $result['command']);
        self::assertSame('PENDENTE', $result['status']);
        self::assertSame('PAUSAR_CARREGAMENTO', $connection->solicitacoes[0]['command']);
        self::assertSame('PAUSAR_CARREGAMENTO', $connection->eventos[0]['action']);
        $payload = $connection->eventos[0]['payload'];
        self::assertMatchesRegularExpression('/^[a-f0-9]{32}$/', (string) ($payload['correlation_id'] ?? ''));
        unset($payload['correlation_id']);
        self::assertSame([
            'command' => 'PAUSAR_CARREGAMENTO',
            'carregamento_id' => 17,
            'equipment_id' => 23,
            'remote_carregamento_id' => null,
            'requires_clp_adapter' => true,
        ], $payload);
    }

    public function testReversaoRegistraComandoPendenteSemAlterarEstadoDoCarregamento(): void
    {
        $connection = new ServicoComandoClpPdoFake();

        $result = (new ServicoComandoClp($connection))->solicitarReversao(
            $this->usuario(),
            17,
            'REVERSAO_DESATIVAR',
        );

        self::assertSame('REVERSAO_DESATIVAR', $result['command']);
        self::assertSame('PENDENTE', $result['status']);
        self::assertSame('REVERSAO_DESATIVAR', $connection->solicitacoes[0]['command']);
        self::assertSame('PREPARANDO', $result['state']);
        self::assertSame('REVERSAO_DESATIVAR', $connection->eventos[0]['action']);
    }

    public function testEmergenciaMantemPrioridadeERegistraTransicaoEComando(): void
    {
        $connection = new ServicoComandoClpPdoFake();

        $result = (new ServicoComandoClp($connection))->solicitarEmergencia($this->usuario(), 17);

        self::assertSame('EMERGENCIA', $result['command']);
        self::assertSame('EMERGENCIA', $result['state']);
        self::assertSame('EMERGENCIA', $connection->solicitacoes[0]['command']);
        self::assertSame('ESTADO_CARREGAMENTO_ALTERADO', $connection->eventos[0]['action']);
        self::assertSame('EMERGENCIA', $connection->eventos[0]['payload']['state']);
        self::assertSame('EMERGENCIA', $connection->eventos[1]['action']);
        self::assertTrue($connection->eventos[1]['payload']['safety_priority']);
    }

    public function testParadaCancelaInicioPendenteERegistraSubstituicao(): void
    {
        $connection = new ServicoComandoClpPdoFake();
        $connection->comandoPendente = [
            'id' => 410,
            'status' => 'PENDENTE',
            'command' => 'INICIAR_CARREGAMENTO',
        ];

        $result = (new ServicoComandoClp($connection))->solicitarOperacao(
            $this->usuario(),
            17,
            'PAUSAR_CARREGAMENTO',
        );

        self::assertSame('PAUSAR_CARREGAMENTO', $result['command']);
        self::assertSame([[
            'id' => 410,
            'message' => 'Comando substituído por PAUSAR_CARREGAMENTO antes da escrita física.',
        ]], $connection->comandosCancelados);
        self::assertSame('INICIAR_CARREGAMENTO', $connection->eventos[0]['payload']['command']);
        self::assertSame('REJEITADO', $connection->eventos[0]['payload']['status']);
        self::assertSame('PAUSAR_CARREGAMENTO', $connection->eventos[0]['payload']['replaced_by']);
    }

    public function testReversaoCancelaComandoOperacionalPendenteAntesDeEnfileirar(): void
    {
        $connection = new ServicoComandoClpPdoFake();
        $connection->comandoPendente = [
            'id' => 411,
            'status' => 'PENDENTE',
            'command' => 'PAUSAR_CARREGAMENTO',
        ];

        $result = (new ServicoComandoClp($connection))->solicitarReversao(
            $this->usuario(),
            17,
            'REVERSAO_DESATIVAR',
        );

        self::assertSame('REVERSAO_DESATIVAR', $result['command']);
        self::assertSame(411, $connection->comandosCancelados[0]['id']);
        self::assertSame('PAUSAR_CARREGAMENTO', $connection->eventos[0]['payload']['command']);
        self::assertSame('REVERSAO_DESATIVAR', $connection->eventos[0]['payload']['replaced_by']);
    }
}
