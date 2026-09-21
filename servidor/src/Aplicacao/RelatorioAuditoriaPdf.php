<?php
declare(strict_types=1);

namespace App\Aplicacao;

/**
 * Gerador PDF leve, sem dependência externa, para auditoria local/offline.
 * Mantém cabeçalho e rodapé em todas as páginas e evita que linhas de tabela
 * sejam separadas no meio durante a paginação.
 */
final class RelatorioAuditoriaPdf
{
    private const WIDTH = 595;
    private const HEIGHT = 842;
    private const CONTENT_LEFT = 40;
    private const CONTENT_RIGHT = 555;
    private const TOP = 758;
    private const BOTTOM = 56;
    /** @var list<string> */
    private array $pages = [];
    /** @var list<string> */
    private array $content = [];
    /** @var array<string, array{data:string,width:int,height:int}> */
    private array $images = [];
    private int $imageSequence = 0;
    private float $y = self::TOP;

    public function __construct(
        private readonly string $companyName,
        private readonly string $reportTitle,
    ) {
        $this->newPage();
    }

    public function heading(string $text): void
    {
        $this->ensure(76);
        $this->text($text, self::CONTENT_LEFT, $this->y, 12, true);
        $this->line(
            self::CONTENT_LEFT,
            $this->y - 8,
            self::CONTENT_RIGHT,
            $this->y - 8,
        );
        $this->y -= 26;
    }

    /** @param array<string, scalar|null> $rows */
    public function summaryCards(array $rows): void
    {
        $gap = 14;
        $cellWidth = (self::CONTENT_RIGHT - self::CONTENT_LEFT - $gap * 2) / 3;
        $pairs = array_chunk($rows, 3, true);
        foreach ($pairs as $pair) {
            $this->ensure(48);
            $x = (float) self::CONTENT_LEFT;
            foreach ($pair as $label => $value) {
                $this->text((string) $label, $x, $this->y, 7.5);
                foreach (
                    $this->wrap((string) ($value ?? "—"), max(12, (int) floor($cellWidth / 5.5)))
                    as $index => $line
                ) {
                    if ($index > 1) {
                        break;
                    }
                    $this->text(
                        $line,
                        $x,
                        $this->y - 14 - $index * 10,
                        9.5,
                        true,
                    );
                }
                $this->line($x, $this->y - 34, $x + $cellWidth, $this->y - 34);
                $x += $cellWidth + $gap;
            }
            $this->y -= 46;
        }
        $this->y -= 8;
    }

    /** @param list<string> $headers @param list<list<string|int|float|null>> $rows @param list<int> $widths */
    public function table(array $headers, array $rows, array $widths): void
    {
        $this->tableHeader($headers, $widths);
        foreach ($rows as $row) {
            $linesByCell = [];
            $lineCount = 1;
            foreach ($row as $index => $value) {
                $linesByCell[$index] = $this->wrap(
                    (string) ($value ?? "—"),
                    max(8, (int) floor($widths[$index] / 5.8)),
                );
                $lineCount = max($lineCount, count($linesByCell[$index]));
            }
            $height = max(18, $lineCount * 12 + 8);
            if ($this->y - $height < self::BOTTOM) {
                $this->newPage();
                $this->tableHeader($headers, $widths);
            }
            $x = (float) self::CONTENT_LEFT;
            foreach ($widths as $index => $width) {
                foreach ($linesByCell[$index] as $lineIndex => $line) {
                    $this->text(
                        $line,
                        $x + 4,
                        $this->y - 13 - $lineIndex * 12,
                        8.5,
                    );
                }
                $x += $width;
            }
            $this->line(
                self::CONTENT_LEFT,
                $this->y - $height,
                self::CONTENT_RIGHT,
                $this->y - $height,
            );
            $this->y -= $height;
        }
        $this->y -= 10;
    }

    public function paragraph(string $text): void
    {
        foreach ($this->wrap($text, 92) as $line) {
            $this->ensure(13);
            $this->text($line, self::CONTENT_LEFT, $this->y, 8.5);
            $this->y -= 13;
        }
        $this->y -= 3;
    }

    /**
     * Adds a JPEG evidence image to the report. Unsupported or unreadable files
     * are deliberately ignored so one bad camera file cannot break the PDF.
     */
    public function incidentImage(string $path, string $caption = ""): bool
    {
        if (!is_file($path) || !is_readable($path)) {
            return false;
        }
        $info = @getimagesize($path);
        if ($info === false || $info["mime"] !== "image/jpeg") {
            return false;
        }
        $data = @file_get_contents($path);
        if ($data === false || $data === "") {
            return false;
        }
        $alias = "Im" . (++$this->imageSequence);
        $this->images[$alias] = [
            "data" => $data,
            "width" => (int) $info[0],
            "height" => (int) $info[1],
        ];
        $maxWidth = 245.0;
        $maxHeight = 170.0;
        $scale = min($maxWidth / $info[0], $maxHeight / $info[1], 1.0);
        $width = $info[0] * $scale;
        $height = $info[1] * $scale;
        $blockHeight = $height + ($caption !== "" ? 28 : 8);
        $this->ensure($blockHeight);
        $x = (float) self::CONTENT_LEFT;
        $y = $this->y - $height;
        $this->content[] = sprintf(
            "q %.2F 0 0 %.2F %.2F %.2F cm /%s Do Q",
            $width,
            $height,
            $x,
            $y,
            $alias,
        );
        if ($caption !== "") {
            foreach ($this->wrap($caption, 52) as $index => $line) {
                $this->text($line, $x, $y - 14 - $index * 10, 8);
                if ($index >= 1) {
                    break;
                }
            }
        }
        $this->y -= $blockHeight;
        return true;
    }

    public function output(): string
    {
        $this->finishPage();
        $objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
        $imageRefs = [];
        foreach ($this->images as $alias => $image) {
            $imageId = count($objects) + 1;
            $imageRefs[$alias] = $imageId;
            $objects[] =
                "<< /Type /XObject /Subtype /Image /Width " .
                $image["width"] .
                " /Height " .
                $image["height"] .
                " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " .
                strlen($image["data"]) .
                " >>\nstream\n" .
                $image["data"] .
                "\nendstream";
        }
        $pageRefs = [];
        foreach ($this->pages as $page) {
            $contentId = count($objects) + 1;
            $objects[] =
                "<< /Length " .
                strlen($page) .
                " >>\nstream\n{$page}\nendstream";
            $pageId = count($objects) + 1;
            $pageRefs[] = "{$pageId} 0 R";
            $xObjects = "";
            foreach ($imageRefs as $alias => $imageId) {
                $xObjects .= "/{$alias} {$imageId} 0 R ";
            }
            $objects[] =
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " .
                self::WIDTH .
                " " .
                self::HEIGHT .
                "] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> /XObject << {$xObjects} >> >> /Contents {$contentId} 0 R >>";
        }
        $objects[1] =
            "<< /Type /Pages /Kids [" .
            implode(" ", $pageRefs) .
            "] /Count " .
            count($pageRefs) .
            " >>";
        $pdf = "%PDF-1.4\n";
        $offsets = [0];
        foreach ($objects as $index => $object) {
            $offsets[$index + 1] = strlen($pdf);
            $pdf .= $index + 1 . " 0 obj\n{$object}\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= "xref\n0 " . (count($objects) + 1) . "\n0000000000 65535 f \n";
        for ($index = 1; $index <= count($objects); $index++) {
            $pdf .= sprintf("%010d 00000 n ", $offsets[$index]) . "\n";
        }
        return $pdf .
            "trailer\n<< /Size " .
            (count($objects) + 1) .
            " /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF";
    }

    private function newPage(): void
    {
        if ($this->content !== []) {
            $this->finishPage();
        }
        $this->content = [];
        $this->y = self::TOP;
        $this->text(
            $this->companyName . " — Relatório de auditoria",
            self::CONTENT_LEFT,
            812,
            9,
            true,
        );
        $this->text($this->reportTitle, self::CONTENT_LEFT, 796, 8);
        $this->line(self::CONTENT_LEFT, 782, self::CONTENT_RIGHT, 782);
        $this->y = self::TOP;
    }

    private function finishPage(): void
    {
        $page = count($this->pages) + 1;
        $this->line(self::CONTENT_LEFT, 34, self::CONTENT_RIGHT, 34);
        $this->text("Dallogix Trace — Relatório de auditoria", self::CONTENT_LEFT, 20, 8);
        $this->text("Página " . $page, 500, 20, 8);
        $this->pages[] = implode("\n", $this->content);
        $this->content = [];
    }

    /** @param list<string> $headers @param list<int> $widths */
    private function tableHeader(array $headers, array $widths): void
    {
        $this->ensure(48);
        $this->rect(
            self::CONTENT_LEFT,
            $this->y - 22,
            array_sum($widths),
            22,
            true,
        );
        $x = (float) self::CONTENT_LEFT;
        foreach ($headers as $index => $header) {
            $this->text($header, $x + 4, $this->y - 14, 8, true);
            $x += $widths[$index];
        }
        $this->y -= 22;
    }

    private function ensure(float $height): void
    {
        if ($this->y - $height < self::BOTTOM) {
            $this->newPage();
        }
    }
    private function text(
        string $text,
        float $x,
        float $y,
        float $size,
        bool $bold = false,
    ): void {
        $encoded =
            iconv("UTF-8", "Windows-1252//TRANSLIT//IGNORE", $text) ?: $text;
        $encoded = str_replace(
            ["\\", "(", ")"],
            ["\\\\", "\\(", "\\)"],
            $encoded,
        );
        $this->content[] = sprintf(
            "BT /%s %.1F Tf %.1F %.1F Td (%s) Tj ET",
            $bold ? "F2" : "F1",
            $size,
            $x,
            $y,
            $encoded,
        );
    }
    private function line(float $x1, float $y1, float $x2, float $y2): void
    {
        $this->content[] = sprintf(
            "0.72 G %.1F %.1F m %.1F %.1F l S 0 G",
            $x1,
            $y1,
            $x2,
            $y2,
        );
    }
    private function rect(
        float $x,
        float $y,
        float $width,
        float $height,
        bool $fill,
    ): void {
        $this->content[] = sprintf(
            "%s %.1F %.1F %.1F %.1F re %s",
            $fill ? "0.94 g" : "0.84 G",
            $x,
            $y,
            $width,
            $height,
            $fill ? "f 0 g" : "S 0 G",
        );
    }
    /** @return list<string> */
    private function wrap(string $text, int $limit): array
    {
        $words = preg_split("/\s+/u", trim($text)) ?: ["—"];
        $lines = [];
        $current = "";
        foreach ($words as $word) {
            $candidate = $current === "" ? $word : $current . " " . $word;
            if (mb_strlen($candidate) > $limit && $current !== "") {
                $lines[] = $current;
                $current = $word;
            } else {
                $current = $candidate;
            }
        }
        if ($current !== "") {
            $lines[] = $current;
        }
        return $lines ?: ["—"];
    }
}
