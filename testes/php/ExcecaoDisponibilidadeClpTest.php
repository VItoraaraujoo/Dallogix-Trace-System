<?php

declare(strict_types=1);

use App\Aplicacao\ExcecaoDisponibilidadeClp;
use PHPUnit\Framework\TestCase;

final class ExcecaoDisponibilidadeClpTest extends TestCase
{
    public function testPreservaOStatusHttpDaFalhaDoClp(): void
    {
        $exception = new ExcecaoDisponibilidadeClp("CLP indisponível", 423);

        self::assertSame(423, $exception->httpStatus);
        self::assertSame("CLP indisponível", $exception->getMessage());
    }
}
