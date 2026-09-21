<?php

declare(strict_types=1);

require_once __DIR__ . "/../../servidor/src/Aplicacao/ServicoEstadoCarregamento.php";

use App\Aplicacao\ServicoEstadoCarregamento;
use PHPUnit\Framework\TestCase;

final class EstadoCarregamentoTest extends TestCase
{
    public function testMatrizDeEstadosMantemEmergenciaSemAtalho(): void
    {
        $reflection = new ReflectionClass(ServicoEstadoCarregamento::class);
        $transitions = $reflection->getReflectionConstant("TRANSITIONS")?->getValue();

        self::assertIsArray($transitions);
        self::assertContains("PREPARANDO", $transitions["AGUARDANDO"]);
        self::assertContains("CARREGANDO", $transitions["PAUSADO"]);
        self::assertContains("FINALIZANDO", $transitions["CARREGANDO"]);
        self::assertSame([], $transitions["EMERGENCIA"]);
        self::assertSame([], $transitions["FINALIZADO"]);
    }
}
