<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ContratosEndpointsTest extends TestCase
{
    public function testLeituraFinalizaCarregamentoComContadoresDefinidosNoFluxoAtual(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/operacoes/leituras.php");

        self::assertIsString($source);
        self::assertStringContainsString(
            '$loadingValidCount + 1 >= $loadingPlannedQuantity',
            $source,
        );
        self::assertStringContainsString('"planned_quantity" => $loadingPlannedQuantity', $source);
        self::assertStringContainsString('"valid_readings" => $loadingValidCount + 1', $source);
        self::assertSame(0, preg_match('/(?<![A-Za-z0-9_])\\$plannedQuantity\\b/', $source));
        self::assertSame(0, preg_match('/(?<![A-Za-z0-9_])\\$validCount\\b/', $source));
    }

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

    public function testConsultaLeveDeStatusLiberaASessaoAntesDaConsulta(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/status_dispositivos.php");

        self::assertIsString($source);
        self::assertStringContainsString('exigir_metodo_http(["GET"]);', $source);
        self::assertStringContainsString("session_write_close();", $source);
        self::assertStringContainsString("obterStatusDispositivos(", $source);
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
        $queueRepository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioFilaSincronizacao.php");
        $readiness = file_get_contents(__DIR__ . "/../../servidor/api/sistema/prontidao.php");

        self::assertIsString($endpoint);
        self::assertIsString($queueRepository);
        self::assertIsString($readiness);
        self::assertStringContainsString('"requeue"', $endpoint);
        self::assertStringContainsString("registrar_evento_operacional", $endpoint);
        self::assertStringContainsString("beginTransaction", $endpoint);
        self::assertStringContainsString("resolved_at = NULL", $queueRepository);
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

    public function testSnapshotCentralEntregaCancelamentosEEventosAtrasadosNaoReabremRomaneios(): void
    {
        $snapshot = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $events = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_eventos.php");
        $manifestRepository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioRomaneiosEventos.php");

        self::assertIsString($snapshot);
        self::assertIsString($events);
        self::assertIsString($manifestRepository);
        self::assertStringContainsString('"romaneios_cancelados" => $cancelledManifests', $snapshot);
        self::assertStringContainsString('$manifestEventsRepository->salvarRomaneio($companyId, $entityId, $data)', $events);
        self::assertStringContainsString('in_array($statusAtual, ["FINALIZADO", "CANCELADO"], true)', $manifestRepository);
        self::assertStringContainsString("AND status NOT IN ('FINALIZADO', 'CANCELADO')", $manifestRepository);
    }

    public function testCatalogoDeProdutosDoServidorEReplicadoIntegralmenteNoPcIndustrial(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $repository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioProdutosRemotos.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/052_catalogo_produtos_remoto.sql");

        self::assertIsString($endpoint);
        self::assertIsString($repository);
        self::assertIsString($migration);
        self::assertStringContainsString('"produtos" => $produtos', $endpoint);
        self::assertStringContainsString('"barcodes" => []', $endpoint);
        self::assertStringContainsString("public function sincronizar(", $repository);
        self::assertStringContainsString("remote_product_id", $repository);
        self::assertStringContainsString("remote_product_id", $migration);
    }

    public function testSnapshotSincronizaRomaneiosDaApiComAInstalacaoDaDala(): void
    {
        $snapshot = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_instalacao.php");
        $service = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoSincronizacaoRemota.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/063_romaneios_api_atribuicao_instalacao.sql");

        self::assertIsString($snapshot);
        self::assertIsString($service);
        self::assertIsString($migration);
        self::assertStringContainsString('assigned_installation_id', $snapshot);
        self::assertStringContainsString('"romaneios_disponiveis" => $availableManifests', $snapshot);
        self::assertStringContainsString('sincronizarRomaneiosDisponiveis', $service);
        self::assertStringContainsString('assigned_installation_id', $migration);
    }

    public function testStatusDoPcNaoQuebraSemMigrationEMantemErrosReaisVisiveis(): void
    {
        $groups = ["empresas.php" => "empresas", "sync_status.php" => "sincronizacao", "diagnostico.php" => "sistema"];
        foreach ($groups as $endpoint => $group) {
            $source = file_get_contents(__DIR__ . "/../../servidor/api/" . $group . "/" . $endpoint);

            self::assertIsString($source);
            self::assertStringContainsString("information_schema.tables", $source, $endpoint);
        }

        $companiesEndpoint = file_get_contents(__DIR__ . "/../../servidor/api/empresas/empresas.php");
        self::assertIsString($companiesEndpoint);
        self::assertSame(1, substr_count($companiesEndpoint, "information_schema.tables"));
        self::assertStringContainsString(
            "table_name IN ('instalacoes_industriais', 'status_pc_industrial')",
            $companiesEndpoint,
        );

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

    public function testCadastroLocalESincronizacaoUsamOValidadorCompartilhadoDeCodigoDala(): void
    {
        $localEndpoint = file_get_contents(__DIR__ . "/../../servidor/api/dalas/equipamentos.php");
        $syncEndpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_eventos.php");
        $syncRepository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioDalasEventos.php");

        self::assertIsString($localEndpoint);
        self::assertIsString($syncEndpoint);
        self::assertIsString($syncRepository);
        self::assertStringContainsString('ValidadorCodigoDala::ehValido($code)', $localEndpoint);
        self::assertStringContainsString('ValidadorCodigoDala::ehValido($code)', $syncRepository);
        self::assertStringContainsString('$dalaEventsRepository->salvarDalaVinculada(', $syncEndpoint);
        self::assertStringContainsString('new RepositorioDalasEventos($pdo)', $syncEndpoint);
        self::assertStringContainsString('->excluirDalaVinculada($companyId, $installationId, $equipmentId)', $syncEndpoint);
    }

    public function testSincronizacaoPersisteAuditoriaPorRepositorioComEscopoDaEmpresa(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_eventos.php");
        $repository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioAuditoriaEventosSincronizacao.php");

        self::assertIsString($endpoint);
        self::assertIsString($repository);
        self::assertStringContainsString('new RepositorioAuditoriaEventosSincronizacao($pdo)', $endpoint);
        self::assertStringContainsString('$auditEventsRepository->buscarAcoesPorUuid(', $endpoint);
        self::assertStringContainsString('$auditEventsRepository->registrar($auditData, $replay)', $endpoint);
        self::assertStringNotContainsString('SELECT id FROM logs_auditoria WHERE company_id = :company_id AND event_uuid = :event_uuid LIMIT 1', $endpoint);
        self::assertStringContainsString('WHERE company_id = :company_id AND event_uuid = :event_uuid', $repository);
        self::assertStringContainsString('public function registrar(array $event, bool $jaRegistrado): void', $repository);
    }

    public function testEventosDeCarregamentoUsamRepositorioEspecializado(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_eventos.php");
        $repository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioCarregamentosEventos.php");
        $service = file_get_contents(__DIR__ . "/../../servidor/src/Aplicacao/ServicoPreparacaoCarregamentoSincronizado.php");

        self::assertIsString($endpoint);
        self::assertIsString($repository);
        self::assertIsString($service);
        self::assertStringContainsString('new ServicoPreparacaoCarregamentoSincronizado(', $endpoint);
        self::assertStringContainsString('$loadingPreparationService->preparar(', $endpoint);
        self::assertStringContainsString('$this->carregamentos->salvar(', $service);
        self::assertStringContainsString('$this->carregamentos->localizarPorOrigem(', $service);
        self::assertStringContainsString('public function finalizarPorRomaneio(', $repository);
    }

    public function testSincronizacaoUsaRepositoriosParaRetornosDeComandoEStatus(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/sincronizacao/sincronizacao_eventos.php");
        $commands = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioComandosEventos.php");
        $statuses = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioStatusDispositivosEventos.php");

        self::assertIsString($endpoint);
        self::assertIsString($commands);
        self::assertIsString($statuses);
        self::assertStringContainsString('$commandEventsRepository->registrarRetorno(', $endpoint);
        self::assertStringContainsString('$deviceStatusEventsRepository->registrar(', $endpoint);
        self::assertStringContainsString('WHERE id = :id AND company_id = :company_id AND equipment_id = :equipment_id', $commands);
        self::assertStringContainsString('ON DUPLICATE KEY UPDATE', $statuses);
    }

    public function testStatusDasDalasReutilizaConsultaDeMaquinasSemSnapshotAgregado(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/dalas/status_dalas.php");

        self::assertIsString($endpoint);
        self::assertStringContainsString("ServicoMonitoramento", $endpoint);
        self::assertStringContainsString("->obterMaquinas(", $endpoint);
        self::assertStringContainsString("session_write_close();", $endpoint);
        self::assertStringNotContainsString("obterInstantaneo(", $endpoint);
        self::assertStringContainsString('"equipment_id" => (int) $machine["id"]', $endpoint);
        self::assertStringContainsString('"status_label" => $rotuloStatus', $endpoint);
    }

    public function testRegistroDeLeituraReutilizaContadorBloqueadoDoCarregamento(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/operacoes/leituras.php");

        self::assertIsString($endpoint);
        self::assertStringContainsString("->buscarLeituraOfflineRegistrada(", $endpoint);
        self::assertStringContainsString("c.equipment_id, c.leituras_validas", $endpoint);
        self::assertStringContainsString('$loadingValidCount = (int) $loading["leituras_validas"];', $endpoint);
        self::assertStringNotContainsString(
            "SELECT leituras_validas FROM carregamentos WHERE id = :carregamento_id FOR UPDATE",
            $endpoint,
        );
        self::assertStringContainsString("ClassificadorLeitura", $endpoint);
    }

    public function testContagemPorProdutoFiltraEmpresaETemIndiceComposto(): void
    {
        $endpoint = file_get_contents(__DIR__ . "/../../servidor/api/operacoes/leituras.php");
        $repository = file_get_contents(__DIR__ . "/../../servidor/src/Persistencia/RepositorioLeituras.php");
        $migration = file_get_contents(__DIR__ . "/../../banco-de-dados/migrations/070_indice_contagem_produto_carregamento.sql");

        self::assertIsString($endpoint);
        self::assertIsString($repository);
        self::assertIsString($migration);
        self::assertStringContainsString("RepositorioLeituras", $endpoint);
        self::assertStringContainsString("->buscarProdutoAtivoPorCodigo(", $endpoint);
        self::assertStringNotContainsString("FROM codigos_produtos pc", $endpoint);
        self::assertStringContainsString("WHERE l.company_id = :reading_company_id", $repository);
        self::assertStringContainsString("ri.company_id = :company_id", $repository);
        self::assertStringContainsString(
            "idx_reading_company_loading_result_product (company_id, carregamento_id, result, product_id)",
            $migration,
        );
    }

    public function testCriacaoDeEmpresaSoConverteChaveDuplicadaEmConflito(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/empresas/empresas.php");
        self::assertIsString($source);
        $postStart = strpos($source, 'if ($_SERVER["REQUEST_METHOD"] === "POST")');
        $putStart = strpos($source, 'if ($_SERVER["REQUEST_METHOD"] === "PUT")', $postStart);
        self::assertNotFalse($postStart);
        self::assertNotFalse($putStart);
        $postHandler = substr($source, $postStart, $putStart - $postStart);
        $creationStart = strpos($postHandler, '$nomeEmpresa = trim');
        self::assertNotFalse($creationStart);
        $creationHandler = substr($postHandler, $creationStart);

        self::assertStringContainsString('catch (PDOException $exception)', $creationHandler);
        self::assertStringContainsString('$exception->errorInfo[1] ?? 0', $creationHandler);
        self::assertStringContainsString('throw $exception;', $creationHandler);
        self::assertSame(1, substr_count($creationHandler, 'catch (Throwable $exception)'));
    }
}
