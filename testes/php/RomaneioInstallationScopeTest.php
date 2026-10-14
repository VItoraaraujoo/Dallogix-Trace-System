<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class RomaneioInstallationScopeTest extends TestCase
{
    public function testNumeroPodeSeRepetirEmDestinosDiferentesMasNaoNaMesmaInstalacao(): void
    {
        $pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('CREATE TABLE romaneios (
            company_id INTEGER NOT NULL,
            remote_installation_id INTEGER NULL,
            assigned_installation_id INTEGER NULL,
            number TEXT NOT NULL
        )');
        $pdo->exec('CREATE UNIQUE INDEX uq_romaneio_company_installation_number
            ON romaneios (company_id, COALESCE(assigned_installation_id, remote_installation_id, 0), number)');
        $insert = $pdo->prepare(
            'INSERT INTO romaneios (company_id, remote_installation_id, assigned_installation_id, number)
             VALUES (:company_id, :remote_installation_id, :assigned_installation_id, :number)',
        );

        $insert->execute(['company_id' => 1, 'remote_installation_id' => null, 'assigned_installation_id' => 10, 'number' => 'ROM-1']);
        $insert->execute(['company_id' => 1, 'remote_installation_id' => null, 'assigned_installation_id' => 20, 'number' => 'ROM-1']);
        $insert->execute(['company_id' => 1, 'remote_installation_id' => 30, 'assigned_installation_id' => null, 'number' => 'ROM-2']);
        $insert->execute(['company_id' => 1, 'remote_installation_id' => 31, 'assigned_installation_id' => null, 'number' => 'ROM-2']);

        try {
            $insert->execute(['company_id' => 1, 'remote_installation_id' => null, 'assigned_installation_id' => 10, 'number' => 'ROM-1']);
            self::fail('A mesma instalação não deve aceitar o mesmo número duas vezes.');
        } catch (PDOException) {
            self::assertSame(4, (int) $pdo->query('SELECT COUNT(*) FROM romaneios')->fetchColumn());
        }

        $insert->execute(['company_id' => 1, 'remote_installation_id' => null, 'assigned_installation_id' => null, 'number' => 'ROM-3']);
        try {
            $insert->execute(['company_id' => 1, 'remote_installation_id' => null, 'assigned_installation_id' => null, 'number' => 'ROM-3']);
            self::fail('Registros locais sem origem ou atribuição devem manter a unicidade anterior.');
        } catch (PDOException) {
            self::assertSame(5, (int) $pdo->query('SELECT COUNT(*) FROM romaneios')->fetchColumn());
        }
    }

    public function testMigracaoUsaDestinoDaAtribuicaoAntesDaOrigemRemota(): void
    {
        $migration = file_get_contents(__DIR__ . '/../../banco-de-dados/migrations/064_romaneio_scope_por_destino.sql');

        self::assertIsString($migration);
        self::assertStringContainsString(
            'COALESCE(assigned_installation_id, remote_installation_id, 0)',
            $migration,
        );
        self::assertStringContainsString('DROP INDEX uq_romaneio_company_installation_number', $migration);
        self::assertStringContainsString(
            '(company_id, (COALESCE(assigned_installation_id, remote_installation_id, 0)), number)',
            $migration,
        );
    }
}
