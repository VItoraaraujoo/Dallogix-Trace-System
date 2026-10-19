<?php

declare(strict_types=1);

require_once __DIR__ . "/../../servidor/src/Aplicacao/ClassificadorLeitura.php";

use App\Aplicacao\ClassificadorLeitura;
use PHPUnit\Framework\TestCase;

final class ClassificadorLeituraTest extends TestCase
{
    public function testLeituraSemCodigoOuComProdutoDesconhecidoEIncorreto(): void
    {
        $classifier = new ClassificadorLeitura();

        self::assertSame(
            "SEM_LEITURA",
            $classifier->classificar(false, null, 0, 0, 10, 0)["result"],
        );
        self::assertSame(
            "PRODUTO_INCORRETO",
            $classifier->classificar(true, null, 0, 0, 10, 0)["result"],
        );
    }

    public function testProdutoPrevistoFicaValidoAteAQuantidadeEPrevistoComoExcessoDepois(): void
    {
        $classifier = new ClassificadorLeitura();

        self::assertSame(
            ["result" => "VALIDO", "product_id" => 42, "product_planned_quantity" => 10, "product_valid_count" => 4],
            $classifier->classificar(true, 42, 10, 4, 20, 4),
        );
        self::assertSame(
            "EXCESSO",
            $classifier->classificar(true, 42, 10, 10, 20, 10)["result"],
        );
        self::assertSame(
            "EXCESSO",
            $classifier->classificar(true, 42, 10, 0, 10, 10)["result"],
        );
    }

    public function testProdutoEncontradoMasAusenteDoRomaneioNaoRecebeProductIdNaLeitura(): void
    {
        $result = (new ClassificadorLeitura())->classificar(true, 42, 0, 0, 10, 0);

        self::assertSame("PRODUTO_INCORRETO", $result["result"]);
        self::assertNull($result["product_id"]);
    }
}
