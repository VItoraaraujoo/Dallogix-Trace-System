<?php

declare(strict_types=1);

use App\Aplicacao\ValidadorCodigoDala;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Aplicacao/ValidadorCodigoDala.php";

final class ValidadorCodigoDalaTest extends TestCase
{
    public function testAceitaIdentificadoresUsadosPeloSeedEInstalador(): void
    {
        self::assertTrue(ValidadorCodigoDala::ehValido("EST-001"));
        self::assertTrue(ValidadorCodigoDala::ehValido("DALA-01"));
        self::assertTrue(ValidadorCodigoDala::ehValido("esteira_1"));
    }

    public function testRejeitaCodigoVazioCaracteresDeEstruturaEExcessoDeTamanho(): void
    {
        self::assertFalse(ValidadorCodigoDala::ehValido(""));
        self::assertFalse(ValidadorCodigoDala::ehValido("Dala 1"));
        self::assertFalse(ValidadorCodigoDala::ehValido("DALA/01"));
        self::assertFalse(ValidadorCodigoDala::ehValido(str_repeat("A", 31)));
    }
}
