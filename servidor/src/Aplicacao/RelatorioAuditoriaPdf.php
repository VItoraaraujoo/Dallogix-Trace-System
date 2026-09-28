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
    /** @var array<string, array{data:string,width:int,height:int,colorSpace:string,filter:string,colors:int,alpha?:array{data:string,width:int,height:int,colorSpace:string,filter:string,colors:int},sourceData?:string,sourceMime?:string}> */
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
     * Adds a JPEG or PNG evidence image to the report. Unsupported or unreadable files
     * are deliberately ignored so one bad camera file cannot break the PDF.
     */
    public function incidentImage(string $path, string $caption = ""): bool
    {
        if (!is_file($path) || !is_readable($path)) {
            return false;
        }
        $data = @file_get_contents($path);
        if ($data === false || $data === "") {
            return false;
        }
        $info = @getimagesizefromstring($data);
        if ($info === false || !in_array($info["mime"], ["image/jpeg", "image/png"], true)) {
            return false;
        }
        return $this->incidentImageData($data, $info["mime"], $caption);
    }

    /**
     * Embeds a JPEG or PNG directly in the PDF. When $preserveSource is true,
     * the source bytes are also kept as a private PDF stream so a later report
     * can be rebuilt without ever persisting a standalone image file.
     */
    public function incidentImageData(
        string $data,
        string $mime,
        string $caption = "",
        bool $preserveSource = false,
    ): bool {
        if ($data === "" || strlen($data) > 5 * 1024 * 1024) {
            return false;
        }
        $info = @getimagesizefromstring($data);
        if ($info === false || $info["mime"] !== $mime
            || !in_array($mime, ["image/jpeg", "image/png"], true)
            || $info[0] < 1 || $info[1] < 1 || $info[0] > 10000 || $info[1] > 10000) {
            return false;
        }
        $image = $mime === "image/jpeg"
            ? [
                "data" => $data,
                "width" => (int) $info[0],
                "height" => (int) $info[1],
                "colorSpace" => (($info["channels"] ?? 3) === 4 ? "/DeviceCMYK" : "/DeviceRGB"),
                "filter" => "DCTDecode",
                "colors" => (($info["channels"] ?? 3) === 4 ? 4 : 3),
            ]
            : self::pngImageResource($data);
        if ($image === null) {
            return false;
        }
        if ($preserveSource) {
            $image["sourceData"] = $data;
            $image["sourceMime"] = $mime;
        }
        $alias = "Im" . (++$this->imageSequence);
        $this->images[$alias] = $image;
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

    /** @return list<array{bytes:string,mime:string}> */
    public static function extractSourceImagesFromPdf(string $pdf): array
    {
        $images = [];
        $cursor = 0;
        while (($marker = strpos($pdf, "/Type /TraceSourceImage", $cursor)) !== false) {
            $tail = substr($pdf, $marker);
            if (preg_match(
                '/\\A\/Type \/TraceSourceImage \/Subtype \/(JPEG|PNG) \/Length ([0-9]+) >>\\nstream\\n/',
                $tail,
                $matches,
            ) !== 1) {
                $cursor = $marker + 1;
                continue;
            }
            $length = (int) $matches[2];
            $dataStart = $marker + strlen($matches[0]);
            if ($length < 1 || $length > 5 * 1024 * 1024 || $dataStart + $length > strlen($pdf)) {
                $cursor = $marker + 1;
                continue;
            }
            $bytes = substr($pdf, $dataStart, $length);
            $mime = $matches[1] === "JPEG" ? "image/jpeg" : "image/png";
            $info = @getimagesizefromstring($bytes);
            if ($info !== false && $info["mime"] === $mime) {
                $images[] = ["bytes" => $bytes, "mime" => $mime];
            }
            $cursor = $dataStart + $length;
        }
        return $images;
    }

    /** @return array{data:string,width:int,height:int,colorSpace:string,filter:string,colors:int,alpha?:array{data:string,width:int,height:int,colorSpace:string,filter:string,colors:int}}|null */
    private static function pngImageResource(string $png): ?array
    {
        if (!str_starts_with($png, "\x89PNG\r\n\x1a\n")) {
            return null;
        }
        $offset = 8;
        $width = $height = $bitDepth = $colorType = $interlace = null;
        $palette = "";
        $transparency = "";
        $compressed = "";
        $length = strlen($png);
        while ($offset + 12 <= $length) {
            $chunkLength = unpack("N", substr($png, $offset, 4))[1];
            $type = substr($png, $offset + 4, 4);
            $offset += 8;
            if ($chunkLength > $length - $offset - 4) {
                return null;
            }
            $chunk = substr($png, $offset, $chunkLength);
            $offset += $chunkLength + 4;
            if ($type === "IHDR" && $chunkLength === 13) {
                $header = unpack("Nwidth/Nheight/CbitDepth/CcolorType/Ccompression/Cfilter/Cinterlace", $chunk);
                $width = (int) $header["width"];
                $height = (int) $header["height"];
                $bitDepth = (int) $header["bitDepth"];
                $colorType = (int) $header["colorType"];
                $interlace = (int) $header["interlace"];
                if ($header["compression"] !== 0 || $header["filter"] !== 0) {
                    return null;
                }
            } elseif ($type === "PLTE") {
                $palette = $chunk;
            } elseif ($type === "tRNS") {
                $transparency = $chunk;
            } elseif ($type === "IDAT") {
                $compressed .= $chunk;
            } elseif ($type === "IEND") {
                break;
            }
        }
        if (!$width || !$height || $width > 10000 || $height > 10000 || $width * $height > 6_000_000
            || $bitDepth !== 8 || $interlace !== 0 || $compressed === "") {
            return null;
        }
        $channels = match ($colorType) {
            0 => 1,
            2 => 3,
            3 => 1,
            4 => 2,
            6 => 4,
            default => 0,
        };
        if ($channels === 0 || ($colorType === 3 && ($palette === "" || strlen($palette) % 3 !== 0))) {
            return null;
        }
        $rowLength = $width * $channels;
        $expectedLength = ($rowLength + 1) * $height;
        if ($expectedLength > 48 * 1024 * 1024) {
            return null;
        }
        $decoded = @gzuncompress($compressed, $expectedLength);
        if (!is_string($decoded) || strlen($decoded) !== $expectedLength) {
            return null;
        }
        $rgbRows = "";
        $grayRows = "";
        $alphaRows = "";
        $hasAlpha = false;
        $previous = str_repeat("\0", $rowLength);
        $dataOffset = 0;
        for ($rowIndex = 0; $rowIndex < $height; $rowIndex++) {
            $filter = ord($decoded[$dataOffset++]);
            $row = substr($decoded, $dataOffset, $rowLength);
            $dataOffset += $rowLength;
            if ($filter > 4) {
                return null;
            }
            for ($i = 0; $i < $rowLength; $i++) {
                $value = ord($row[$i]);
                $left = $i >= $channels ? ord($row[$i - $channels]) : 0;
                $up = ord($previous[$i]);
                $upperLeft = $i >= $channels ? ord($previous[$i - $channels]) : 0;
                $predictor = match ($filter) {
                    0 => 0,
                    1 => $left,
                    2 => $up,
                    3 => intdiv($left + $up, 2),
                    4 => self::paethPredictor($left, $up, $upperLeft),
                };
                $row[$i] = chr(($value + $predictor) & 0xff);
            }
            $previous = $row;
            if ($colorType === 0 || $colorType === 2) {
                if ($colorType === 0) {
                    $grayRows .= "\0" . $row;
                    if (strlen($transparency) === 2) {
                        $transparentGray = unpack("n", $transparency)[1];
                        $alpha = "";
                        for ($i = 0; $i < $width; $i++) {
                            $sample = ord($row[$i]);
                            $alpha .= chr($sample === $transparentGray ? 0 : 255);
                        }
                        $alphaRows .= "\0" . $alpha;
                        $hasAlpha = $hasAlpha || str_contains($alpha, "\0");
                    }
                } else {
                    $rgbRows .= "\0" . $row;
                    if (strlen($transparency) === 6) {
                        $transparent = unpack("nred/ngreen/nblue", $transparency);
                        $alpha = "";
                        for ($i = 0; $i < $width; $i++) {
                            $pixel = substr($row, $i * 3, 3);
                            $matches = ord($pixel[0]) === $transparent["red"]
                                && ord($pixel[1]) === $transparent["green"]
                                && ord($pixel[2]) === $transparent["blue"];
                            $alpha .= chr($matches ? 0 : 255);
                        }
                        $alphaRows .= "\0" . $alpha;
                        $hasAlpha = $hasAlpha || str_contains($alpha, "\0");
                    }
                }
                continue;
            }
            $colorRow = "";
            $alphaRow = "";
            if ($colorType === 3) {
                $paletteSize = intdiv(strlen($palette), 3);
                for ($i = 0; $i < $width; $i++) {
                    $index = ord($row[$i]);
                    if ($index >= $paletteSize) {
                        return null;
                    }
                    $colorRow .= substr($palette, $index * 3, 3);
                    $alpha = $index < strlen($transparency) ? ord($transparency[$index]) : 255;
                    $alphaRow .= chr($alpha);
                    $hasAlpha = $hasAlpha || $alpha !== 255;
                }
            } elseif ($colorType === 4) {
                for ($i = 0; $i < $width; $i++) {
                    $colorRow .= $row[$i * 2];
                    $alpha = $row[$i * 2 + 1];
                    $alphaRow .= $alpha;
                    $hasAlpha = $hasAlpha || ord($alpha) !== 255;
                }
            } else {
                for ($i = 0; $i < $width; $i++) {
                    $colorRow .= substr($row, $i * 4, 3);
                    $alpha = $row[$i * 4 + 3];
                    $alphaRow .= $alpha;
                    $hasAlpha = $hasAlpha || ord($alpha) !== 255;
                }
            }
            if ($colorType === 4) {
                $grayRows .= "\0" . $colorRow;
            } else {
                $rgbRows .= "\0" . $colorRow;
            }
            $alphaRows .= "\0" . $alphaRow;
        }
        $colorSpace = $colorType === 0 || $colorType === 4 ? "/DeviceGray" : "/DeviceRGB";
        $colors = $colorSpace === "/DeviceGray" ? 1 : 3;
        $imageData = @gzcompress($colorSpace === "/DeviceGray" ? $grayRows : $rgbRows, 6);
        if (!is_string($imageData)) {
            return null;
        }
        $resource = [
            "data" => $imageData,
            "width" => $width,
            "height" => $height,
            "colorSpace" => $colorSpace,
            "filter" => "FlateDecode",
            "colors" => $colors,
        ];
        if ($hasAlpha) {
            $alphaData = @gzcompress($alphaRows, 6);
            if (!is_string($alphaData)) {
                return null;
            }
            $resource["alpha"] = [
                "data" => $alphaData,
                "width" => $width,
                "height" => $height,
                "colorSpace" => "/DeviceGray",
                "filter" => "FlateDecode",
                "colors" => 1,
            ];
        }
        return $resource;
    }

    private static function paethPredictor(int $left, int $up, int $upperLeft): int
    {
        $base = $left + $up - $upperLeft;
        $leftDistance = abs($base - $left);
        $upDistance = abs($base - $up);
        $upperLeftDistance = abs($base - $upperLeft);
        if ($leftDistance <= $upDistance && $leftDistance <= $upperLeftDistance) {
            return $left;
        }
        return $upDistance <= $upperLeftDistance ? $up : $upperLeft;
    }

    /** @param array{data:string,width:int,height:int,colorSpace:string,filter:string,colors:int} $image */
    private static function pdfImageObject(array $image, ?int $alphaReference = null): string
    {
        $decodeParameters = $image["filter"] === "FlateDecode"
            ? " /DecodeParms << /Predictor 15 /Colors {$image["colors"]} /BitsPerComponent 8 /Columns {$image["width"]} >>"
            : "";
        $softMask = $alphaReference === null ? "" : " /SMask {$alphaReference} 0 R";
        return "<< /Type /XObject /Subtype /Image /Width {$image["width"]} /Height {$image["height"]}"
            . " /ColorSpace {$image["colorSpace"]} /BitsPerComponent 8 /Filter /{$image["filter"]}"
            . $decodeParameters . $softMask . " /Length " . strlen($image["data"]) . " >>\nstream\n"
            . $image["data"] . "\nendstream";
    }

    public function output(): string
    {
        $this->finishPage();
        $objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
        $imageRefs = [];
        foreach ($this->images as $alias => $image) {
            $alphaReference = null;
            if (isset($image["alpha"])) {
                $alphaReference = count($objects) + 1;
                $objects[] = self::pdfImageObject($image["alpha"]);
            }
            $imageId = count($objects) + 1;
            $imageRefs[$alias] = $imageId;
            $objects[] = self::pdfImageObject($image, $alphaReference);
            if (isset($image["sourceData"], $image["sourceMime"])) {
                $subtype = $image["sourceMime"] === "image/jpeg" ? "JPEG" : "PNG";
                $objects[] = "<< /Type /TraceSourceImage /Subtype /{$subtype} /Length "
                    . strlen($image["sourceData"]) . " >>\nstream\n" . $image["sourceData"] . "\nendstream";
            }
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
        // The minimal production image has mbstring conversion tables but its
        // iconv build cannot convert to Windows-1252, which is used by WinAnsi.
        $encoded = mb_convert_encoding($text, "Windows-1252", "UTF-8");
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
