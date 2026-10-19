<?php

declare(strict_types=1);

use App\Aplicacao\AgrupadorItensImportacaoRomaneio;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . "/../../servidor/src/Aplicacao/AgrupadorItensImportacaoRomaneio.php";

final class AgrupadorItensImportacaoRomaneioTest extends TestCase
{
    public function testConsolidaSoLinhasDoMesmoRomaneioCaminhaoEProduto(): void
    {
        $rows = [
            ["romaneio_id" => 1, "truck_id" => 10, "product_id" => 7, "quantity" => 12],
            ["romaneio_id" => 1, "truck_id" => 10, "product_id" => 7, "quantity" => 2],
            ["romaneio_id" => 1, "truck_id" => 11, "product_id" => 7, "quantity" => 5],
            ["romaneio_id" => 2, "truck_id" => 10, "product_id" => 7, "quantity" => 3],
        ];

        $grouped = (new AgrupadorItensImportacaoRomaneio())->agrupar($rows);

        self::assertSame([
            ["romaneio_id" => 1, "truck_id" => 10, "product_id" => 7, "quantity" => 14],
            ["romaneio_id" => 1, "truck_id" => 11, "product_id" => 7, "quantity" => 5],
            ["romaneio_id" => 2, "truck_id" => 10, "product_id" => 7, "quantity" => 3],
        ], $grouped);
    }

    public function testListaVaziaPermaneceVazia(): void
    {
        self::assertSame([], (new AgrupadorItensImportacaoRomaneio())->agrupar([]));
    }
}
