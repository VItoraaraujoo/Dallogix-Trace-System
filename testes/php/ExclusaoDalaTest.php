<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ExclusaoDalaTest extends TestCase
{
    public function testExclusaoDesvinculaTambemCarregamentosHistoricos(): void
    {
        $source = file_get_contents(__DIR__ . "/../../servidor/api/equipamentos.php");

        self::assertIsString($source);
        self::assertStringContainsString("UPDATE carregamentos", $source);
        self::assertStringContainsString("SET equipment_id = NULL", $source);
        self::assertStringContainsString(
            "WHERE company_id = :company_id AND equipment_id = :equipment_id",
            $source,
        );
    }
}
