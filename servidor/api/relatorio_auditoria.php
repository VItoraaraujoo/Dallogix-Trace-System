<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";
require_once __DIR__ . "/../src/Aplicacao/RelatorioAuditoriaPdf.php";

use App\Aplicacao\RelatorioAuditoriaPdf;

$user = require_session_user();
$romaneioId = filter_var($_GET["romaneio_id"] ?? null, FILTER_VALIDATE_INT);
if ($user["company_id"] === null || !$romaneioId) {
    json_response(["error" => "Romaneio obrigatório."], 422);
}

$pdo = db();
$manifest = $pdo->prepare("SELECT r.id, r.number, r.status, r.scheduled_date, r.expedidor,
    c.name AS company_name,
    (SELECT rt.plate FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS plate,
    (SELECT rt.driver_name FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS driver_name
    FROM romaneios r JOIN empresas c ON c.id = r.company_id
    WHERE r.id = :id AND r.company_id = :company_id LIMIT 1");
$manifest->execute(["id" => $romaneioId, "company_id" => $user["company_id"]]);
$romaneio = $manifest->fetch();
if (!$romaneio) {
    json_response(["error" => "Romaneio não encontrado."], 404);
}
if (!in_array($romaneio["status"], ["FINALIZADO", "CANCELADO"], true)) {
    json_response(
        [
            "error" =>
                "O relatório fica disponível após a finalização ou cancelamento do romaneio.",
        ],
        409,
    );
}

$loads = $pdo->prepare('SELECT c.id, c.state, c.started_at, c.finished_at, e.name AS equipment_name, e.equipment_code
    FROM carregamentos c LEFT JOIN equipamentos e ON e.id = c.equipment_id WHERE c.romaneio_id = :id ORDER BY c.id');
$loads->execute(["id" => $romaneioId]);
$loadRows = $loads->fetchAll();
$loadIds = array_map(static fn(array $row): int => (int) $row["id"], $loadRows);
$placeholders = implode(",", array_fill(0, count($loadIds), "?"));
$formatDate = static function (?string $value): string {
    if (!$value) {
        return "—";
    }
    $timestamp = strtotime($value);
    return $timestamp === false ? $value : date("d/m/Y", $timestamp);
};
$formatDateTime = static function (?string $value): string {
    if (!$value) {
        return "—";
    }
    $timestamp = strtotime($value);
    return $timestamp === false ? $value : date("d/m/Y H:i", $timestamp);
};
$equipmentLabels = array_values(array_unique(array_map(
    static fn(array $row): string => trim((string) ($row["equipment_name"] ?: $row["equipment_code"] ?: "Dala")),
    $loadRows,
)));
$firstLoad = $loadRows[0] ?? [];
$lastLoad = $loadRows !== [] ? $loadRows[array_key_last($loadRows)] : [];

$items = $pdo->prepare("SELECT p.name, COALESCE(MIN(pc.barcode), p.code, '—') AS barcode, ri.planned_quantity,
    COALESCE((SELECT COUNT(*) FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id
      WHERE c.romaneio_id = ri.romaneio_id AND l.product_id = ri.product_id
        AND (ri.truck_id IS NULL OR c.truck_id = ri.truck_id)
        AND l.result = 'VALIDO'), 0) AS moved_quantity
    FROM romaneio_itens ri JOIN produtos p ON p.id = ri.product_id
    LEFT JOIN codigos_produtos pc ON pc.product_id = p.id
    WHERE ri.romaneio_id = ? GROUP BY ri.id, p.id ORDER BY ri.id");
$items->execute([$romaneioId]);
$itemRows = $items->fetchAll();

$occurrences = [];
$incidentImages = [];
if ($loadIds !== []) {
    $occurrenceQuery = $pdo->prepare("SELECT o.type, o.quantity, o.description, o.created_at, p.name AS product_name
        FROM ocorrencias o LEFT JOIN produtos p ON p.id = o.product_id WHERE o.carregamento_id IN ({$placeholders}) ORDER BY o.created_at");
    $occurrenceQuery->execute($loadIds);
    $occurrences = $occurrenceQuery->fetchAll();

    $imageQuery = $pdo->prepare("SELECT path, reason, captured_at FROM imagens WHERE carregamento_id IN ({$placeholders}) AND reason <> 'NORMAL' ORDER BY captured_at");
    $imageQuery->execute($loadIds);
    $incidentImages = $imageQuery->fetchAll();
}

$evidenceImages = [];
if ($incidentImages !== []) {
    $storageRoot = realpath(__DIR__ . "/../../armazenamento") ?: "";
    foreach ($incidentImages as $image) {
        $relativePath = ltrim((string) $image["path"], "/");
        if (str_starts_with($relativePath, "armazenamento/")) {
            $relativePath = substr($relativePath, strlen("armazenamento/"));
        }
        $absolutePath = $storageRoot !== "" ? realpath($storageRoot . "/" . $relativePath) : false;
        if (
            $absolutePath !== false &&
            $storageRoot !== "" &&
            str_starts_with($absolutePath, $storageRoot . DIRECTORY_SEPARATOR)
        ) {
            $evidenceImages[] = [
                "path" => $absolutePath,
                "caption" => (string) $image["reason"] . " · " . (string) $image["captured_at"],
            ];
        }
    }
}

$report = new RelatorioAuditoriaPdf(
    (string) $romaneio["company_name"],
    "Romaneio " . $romaneio["number"] . " · " . ($romaneio["status"] === "CANCELADO" ? "Cancelado" : "Finalizado"),
);
$report->heading("Dados do romaneio");
$report->summaryCards([
    "Romaneio" => $romaneio["number"],
    "Status" => $romaneio["status"] === "CANCELADO" ? "Cancelado" : "Finalizado",
    "Data programada" => $formatDate($romaneio["scheduled_date"]),
    "Expedidor" => $romaneio["expedidor"] ?: "—",
    "Placa" => $romaneio["plate"] ?: "—",
    "Motorista" => $romaneio["driver_name"] ?: "—",
    "Dala" => $equipmentLabels !== [] ? implode(", ", $equipmentLabels) : "—",
    "Início" => $formatDateTime($firstLoad["started_at"] ?? null),
    "Fim" => $formatDateTime($lastLoad["finished_at"] ?? null),
]);
if ($romaneio["status"] === "CANCELADO") {
    $report->paragraph("Valores registrados até o cancelamento.");
}
$report->heading("Conferência dos itens");
$report->table(
    ["Produto", "Código", "Previsto", "Movido", "Status"],
    array_map(static function (array $item): array {
        $planned = (int) $item["planned_quantity"];
        $moved = (int) $item["moved_quantity"];
        return [
            $item["name"],
            $item["barcode"],
            $planned,
            $moved,
            $moved === $planned
                ? "Concluído"
                : ($moved < $planned
                    ? "Parcial"
                    : "Excesso"),
        ];
    }, $itemRows),
    [205, 105, 65, 65, 75],
);
$divergences = array_values(
    array_filter(
        $itemRows,
        static fn(array $item): bool => (int) $item["planned_quantity"] !==
            (int) $item["moved_quantity"],
    ),
);
if ($divergences === []) {
    $report->paragraph("Sem divergências.");
} else {
    $report->heading("Divergências");
    $report->table(
        ["Produto", "Código", "Movido / previsto", "Situação"],
        array_map(
            static fn(array $item): array => [
                $item["name"],
                $item["barcode"],
                $item["moved_quantity"] . " / " . $item["planned_quantity"],
                (int) $item["moved_quantity"] < (int) $item["planned_quantity"]
                    ? "Falta"
                    : "Excesso",
            ],
            $divergences,
        ),
        [215, 110, 110, 80],
    );
}
if ($occurrences !== []) {
    $occurrenceLabels = [
        "SACA_RASGADA" => "Saca rasgada",
        "SACA_AVARIADA" => "Saca avariada",
        "PARADA_MAQUINA" => "Parada de máquina",
        "LIMPEZA_LINHA" => "Limpeza de linha",
        "QUEDA_ENERGIA" => "Queda de energia",
        "AJUSTE_EQUIPAMENTO" => "Ajuste de equipamento",
        "FALHA_ELETRICA" => "Falha elétrica",
    ];
    $report->heading("Ocorrências");
    $report->table(
        ["Data/hora", "Tipo", "Produto", "Detalhes"],
        array_map(
            static function (array $row) use ($formatDateTime, $occurrenceLabels): array {
                return [
                    $formatDateTime($row["created_at"]),
                    $occurrenceLabels[$row["type"]] ?? $row["type"],
                    $row["product_name"] ?: "—",
                    $row["description"] ?: "—",
                ];
            },
            $occurrences,
        ),
        [100, 115, 150, 150],
    );
}
if ($evidenceImages !== []) {
    $report->heading("Evidências");
    foreach ($evidenceImages as $image) {
        $report->incidentImage($image["path"], $image["caption"]);
    }
}
record_operational_event(
    $pdo,
    $user,
    "RELATORIO_AUDITORIA_BAIXADO",
    "romaneio",
    (int) $romaneioId,
    [],
);
header_remove("Content-Type");
header("Content-Type: application/pdf");
header(
    'Content-Disposition: attachment; filename="romaneio-' .
        preg_replace("/[^A-Za-z0-9_-]/", "-", (string) $romaneio["number"]) .
        '-auditoria.pdf"',
);
header("Cache-Control: no-store");
echo $report->output();
