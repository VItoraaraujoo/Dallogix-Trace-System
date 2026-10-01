<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ContratosEndpointsTest extends TestCase
{
    public function testExclusaoDeAcaoNaoExigeCorpoJson(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/dalas/acoes_dala.php");

        self::assertIsString($source);
        self::assertStringContainsString(
            'exigir_metodo_http(["GET", "POST", "PATCH", "DELETE"]);',
            $source,
        );
        self::assertStringContainsString(
            '$payload = in_array($method, ["POST", "PATCH"], true) ? request_json() : [];',
            $source,
        );
    }

    public function testLogoutAceitaSomentePost(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/autenticacao/logout.php");

        self::assertIsString($source);
        self::assertStringContainsString('exigir_metodo_http(["POST"]);', $source);
    }

    public function testMutacoesOperacionaisMantemAuditoriaNaMesmaTransacao(): void
    {
        $groups = ["ocorrencias.php" => "operacoes", "configuracoes.php" => "sistema", "sensor_eventos.php" => "operacoes"];
        foreach ($groups as $endpoint => $group) {
            $source = file_get_contents(__DIR__ . "/../../servidor/api/" . $group . "/" . $endpoint);

            self::assertIsString($source);
            self::assertStringContainsString("beginTransaction", $source, $endpoint);
            self::assertStringContainsString("commit", $source, $endpoint);
            self::assertStringContainsString("rollBack", $source, $endpoint);
        }
    }

    public function testFilaMortaPermiteReenfileirarComAuditoria(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sync_dead_letter.php");
        $worker = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoSincronizacao.php");
        $readiness = file_get_contents(__DIR__ . "/../../servidor/api/sistema/prontidao.php");

        self::assertIsString($endpoint);
        self::assertIsString($worker);
        self::assertIsString($readiness);
        self::assertStringContainsString('"requeue"', $endpoint);
        self::assertStringContainsString("registrar_evento_operacional", $endpoint);
        self::assertStringContainsString("beginTransaction", $endpoint);
        self::assertStringContainsString("resolved_at = NULL", $worker);
        self::assertStringContainsString("dead_letter_pending", $readiness);
    }

    public function testHeartbeatDaInstalacaoRegistraPcIndustrialNoServidorCentral(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/051_status_pc_industrial.sql");

        self::assertIsString($endpoint);
        self::assertIsString($migration);
        self::assertStringContainsString('"industrial_pc"', $endpoint);
        self::assertStringContainsString("status_pc_industrial", $endpoint);
        self::assertStringContainsString("status_pc_industrial", $migration);
    }

    public function testHeartbeatConfirmaEventosEntreguesAoPcIndustrial(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $service = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoSincronizacaoRemota.php");

        self::assertIsString($endpoint);
        self::assertIsString($service);
        self::assertStringContainsString('"sync_cursor"', $endpoint);
        self::assertStringContainsString('"delivered_queue_id"', $endpoint);
        self::assertStringContainsString("status IN ('PENDENTE', 'ERRO')", $endpoint);
        self::assertStringContainsString('"delivered_queue_id"', $service);
    }

    public function testCatalogoDeProdutosDoServidorEReplicadoIntegralmenteNoPcIndustrial(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $service = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoSincronizacaoRemota.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/052_catalogo_produtos_remoto.sql");

        self::assertIsString($endpoint);
        self::assertIsString($service);
        self::assertIsString($migration);
        self::assertStringContainsString('"produtos" => $produtos', $endpoint);
        self::assertStringContainsString('"barcodes" => []', $endpoint);
        self::assertStringContainsString("sincronizarProdutos", $service);
        self::assertStringContainsString("remote_product_id", $service);
        self::assertStringContainsString("remote_product_id", $migration);
    }

    public function testStatusDoPcNaoQuebraSemMigrationEMantemErrosReaisVisiveis(): void
    {
        $groups = ["empresas.php" => "empresas", "sync_status.php" => "sincronizacao", "diagnostico.php" => "sistema"];
        foreach ($groups as $endpoint => $group) {
            $source = file_get_contents(__DIR__ . "/../../servidor/api/" . $group . "/" . $endpoint);

            self::assertIsString($source);
            self::assertStringContainsString("information_schema.tables", $source, $endpoint);
        }

        $logs = file_get_contents(__DIR__ . "/../../servidor/api/monitoramento/logs_erros.php");
        $diagnostic = file_get_contents(__DIR__ . "/../../servidor/api/sistema/diagnostico.php");
        self::assertIsString($logs);
        self::assertIsString($diagnostic);
        self::assertStringNotContainsString("information_schema.tables", $logs);
        self::assertStringNotContainsString("resolved_status_pc_error", $logs);
        self::assertStringNotContainsString("resolved_status_pc_error", $diagnostic);
    }

    public function testDetalheCentralDaEmpresaNaoConfundeEstadoOperacionalComFisico(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/empresas/empresas.php");

        self::assertIsString($endpoint);
        self::assertStringContainsString("d.details AS clp_details", $endpoint);
        self::assertStringContainsString("EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes(", $endpoint);
        self::assertStringContainsString('$machine["physical_running"]', $endpoint);
        self::assertStringContainsString('unset($machine["clp_details"])', $endpoint);
        self::assertStringContainsString('"maquinas" => $maquinasData', $endpoint);
    }
}
