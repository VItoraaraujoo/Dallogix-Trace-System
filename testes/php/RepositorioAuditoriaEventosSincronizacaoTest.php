<?php

declare(strict_types=1);

use App\Persistencia\RepositorioAuditoriaEventosSincronizacao;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Persistencia/RepositorioAuditoriaEventosSincronizacao.php";

final class RepositorioAuditoriaEventosSincronizacaoTest extends TestCase
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
        $connection->exec("CREATE TABLE logs_auditoria (
            event_uuid TEXT NOT NULL, company_id INTEGER NOT NULL, user_id INTEGER NULL,
            action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
            metadata TEXT NOT NULL, delivered_at TEXT NULL,
            PRIMARY KEY(company_id, event_uuid)
        )");
        return $connection;
    }

    /** @return array{event_uuid:string,company_id:int,action:string,entity_type:string,entity_id:int,metadata:string} */
    private function event(string $action, int $entityId, string $metadata = "{}"): array
    {
        return [
            "event_uuid" => "event-00000000-0000-0000-0000-000000000001",
            "company_id" => 3,
            "action" => $action,
            "entity_type" => "romaneio",
            "entity_id" => $entityId,
            "metadata" => $metadata,
        ];
    }

    public function testNovoEventoGeraUmaLinhaDeAuditoria(): void
    {
        $connection = $this->database();
        (new RepositorioAuditoriaEventosSincronizacao($connection))->registrar($this->event("ROMANEIO_CRIADO", 12), false);

        self::assertSame(1, (int) $connection->query("SELECT COUNT(*) FROM logs_auditoria")->fetchColumn());
        self::assertSame("ROMANEIO_CRIADO", $connection->query("SELECT action FROM logs_auditoria")->fetchColumn());
        self::assertSame("2026-10-19 12:00:00", $connection->query("SELECT delivered_at FROM logs_auditoria")->fetchColumn());
    }

    public function testReenvioAtualizaAuditoriaSemDuplicarOuAlterarOutraEmpresa(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO logs_auditoria VALUES
            ('event-00000000-0000-0000-0000-000000000001', 3, NULL, 'ROMANEIO_CRIADO', 'romaneio', 12, '{}', NULL),
            ('event-00000000-0000-0000-0000-000000000001', 8, NULL, 'OUTRO_EVENTO', 'romaneio', 44, '{}', NULL)");

        (new RepositorioAuditoriaEventosSincronizacao($connection))->registrar(
            $this->event("ROMANEIO_ATUALIZADO", 13, '{"reenvio":true}'),
            true,
        );

        self::assertSame(2, (int) $connection->query("SELECT COUNT(*) FROM logs_auditoria")->fetchColumn());
        self::assertSame("ROMANEIO_ATUALIZADO", $connection->query("SELECT action FROM logs_auditoria WHERE company_id = 3")->fetchColumn());
        self::assertSame(13, (int) $connection->query("SELECT entity_id FROM logs_auditoria WHERE company_id = 3")->fetchColumn());
        self::assertSame("OUTRO_EVENTO", $connection->query("SELECT action FROM logs_auditoria WHERE company_id = 8")->fetchColumn());
    }

    public function testBuscaAcoesDeUmaEmpresaEmLoteENormalizaUuid(): void
    {
        $connection = $this->database();
        $connection->exec("INSERT INTO logs_auditoria VALUES
            ('event-00000000-0000-0000-0000-000000000001', 3, NULL, 'DALA_EXCLUIDA', 'dala', 7, '{}', NULL),
            ('event-00000000-0000-0000-0000-000000000001', 8, NULL, 'OUTRO_EVENTO', 'dala', 7, '{}', NULL)");

        $actions = (new RepositorioAuditoriaEventosSincronizacao($connection))->buscarAcoesPorUuid(3, [
            "EVENT-00000000-0000-0000-0000-000000000001",
            "event-00000000-0000-0000-0000-000000000001",
            "",
        ]);

        self::assertSame(
            ["event-00000000-0000-0000-0000-000000000001" => "DALA_EXCLUIDA"],
            $actions,
        );
    }

    public function testBuscaEmLoteAceitaListaVazia(): void
    {
        $connection = $this->database();

        self::assertSame([], (new RepositorioAuditoriaEventosSincronizacao($connection))->buscarAcoesPorUuid(3, []));
    }
}
