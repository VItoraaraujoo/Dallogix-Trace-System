<?php

declare(strict_types=1);

use App\Aplicacao\RelatorioAuditoriaPdf;
use App\Aplicacao\DecodificadorImagemPng;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../servidor/src/Aplicacao/RelatorioAuditoriaPdf.php';

final class RelatorioAuditoriaPdfTest extends TestCase
{
    private const PNG_1X1_TRANSPARENTE = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAADUlEQVQImWP4z8DAAAAEAQEAZVHBSgAAAABJRU5ErkJggg==';

    public function testDecodificadorMantemDimensoesECanalAlphaDoPng(): void
    {
        $png = base64_decode(self::PNG_1X1_TRANSPARENTE, true);
        self::assertIsString($png);

        $resource = DecodificadorImagemPng::decodificar($png);

        self::assertNotNull($resource);
        self::assertSame(1, $resource['width']);
        self::assertSame(1, $resource['height']);
        self::assertSame('/DeviceRGB', $resource['colorSpace']);
        self::assertArrayHasKey('alpha', $resource);
        self::assertSame(null, DecodificadorImagemPng::decodificar('png inválido'));
    }

    public function testPreservaImagemPngOriginalDentroDoPdfDeEvidencia(): void
    {
        $png = base64_decode(self::PNG_1X1_TRANSPARENTE, true);
        self::assertIsString($png);

        $report = new RelatorioAuditoriaPdf('Empresa teste', 'Relatório de evidência');
        self::assertTrue($report->inserirDadosDaImagemDaOcorrencia($png, 'image/png', 'Camera 01', true));

        $pdf = $report->obterArquivoPdf();
        $images = RelatorioAuditoriaPdf::extrairImagensOriginaisDoPdf($pdf);

        self::assertStringStartsWith('%PDF-1.4', $pdf);
        self::assertStringContainsString('/Subtype /Image', $pdf);
        self::assertStringContainsString('/SMask', $pdf);
        self::assertSame([['bytes' => $png, 'mime' => 'image/png']], $images);
    }

    public function testRejeitaImagemPngInvalidaSemAcrescentarEvidenciaAoPdf(): void
    {
        $report = new RelatorioAuditoriaPdf('Empresa teste', 'Relatório de evidência');

        self::assertFalse($report->inserirDadosDaImagemDaOcorrencia('imagem inválida', 'image/png', 'Camera 01', true));
        self::assertSame([], RelatorioAuditoriaPdf::extrairImagensOriginaisDoPdf($report->obterArquivoPdf()));
    }
}
