<?php

declare(strict_types=1);

use App\Aplicacao\EstadoFisicoClp;
use PHPUnit\Framework\TestCase;

final class EstadoFisicoClpTest extends TestCase
{
    public function testAceitaSomenteBooleanoExplicitoReportadoPeloClp(): void
    {
        self::assertTrue(EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes('{"physical_running":true}'));
        self::assertFalse(EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes('{"conveyor_running":false}'));
        self::assertTrue(EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes(["running" => true]));
    }

    public function testMantemDesconhecidoSemBooleanoValido(): void
    {
        foreach ([
            null,
            "",
            "json inválido",
            "[]",
            "{\"running\":\"false\"}",
            "{\"running\":0}",
            "{\"physical_running\":null,\"running\":\"true\"}",
        ] as $details) {
            self::assertNull(EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes($details));
        }
    }

    public function testPriorizaCampoFisicoCanonicoQuandoHaAliases(): void
    {
        self::assertTrue(EstadoFisicoClp::estaEmFuncionamentoPelosDetalhes(
            '{"physical_running":true,"running":false}',
        ));
    }
}
