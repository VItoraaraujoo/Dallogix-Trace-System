<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();
$companyId = $user["company_id"];
if ($companyId === null) {
    json_response(["error" => "Usuário sem empresa vinculada."], 403);
}

$pdo = db();

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    // Detalhe de um romaneio específico (tela Visualizar).
    $detailId = filter_var($_GET["id"] ?? null, FILTER_VALIDATE_INT);
    if ($detailId) {
        $header = $pdo->prepare(
            "SELECT r.id, r.number, r.scheduled_date, r.status, r.expedidor, r.created_at, r.updated_at,
                    (SELECT rt.plate FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS plate,
                    (SELECT rt.driver_name FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS driver_name,
                    COALESCE((SELECT SUM(ri.planned_quantity) FROM romaneio_itens ri WHERE ri.romaneio_id = r.id), 0) AS planned_quantity,
                    COALESCE((SELECT COUNT(*) FROM leituras l JOIN carregamentos c2 ON c2.id = l.carregamento_id WHERE c2.romaneio_id = r.id AND l.result = 'VALIDO'), 0) AS loaded_quantity
             FROM romaneios r WHERE r.id = :id AND r.company_id = :company_id LIMIT 1",
        );
        $header->execute(["id" => $detailId, "company_id" => $companyId]);
        $romaneio = $header->fetch();
        if (!$romaneio) {
            json_response(["error" => "Romaneio não encontrado."], 404);
        }
        $items = $pdo->prepare(
            'SELECT ri.id, ri.product_id, ri.truck_id, ri.planned_quantity, p.code, p.name, p.category,
                    COALESCE((SELECT pc.barcode FROM codigos_produtos pc WHERE pc.product_id = p.id ORDER BY pc.id LIMIT 1), \'\') AS barcode
             FROM romaneio_itens ri JOIN produtos p ON p.id = ri.product_id
             WHERE ri.romaneio_id = :id ORDER BY ri.id',
        );
        $items->execute(["id" => $detailId]);
        $romaneio["items"] = $items->fetchAll();
        $trucks = $pdo->prepare(
            "SELECT id, plate, driver_name FROM romaneio_caminhoes WHERE romaneio_id = :id ORDER BY id",
        );
        $trucks->execute(["id" => $detailId]);
        $romaneio["trucks"] = $trucks->fetchAll();
        json_response(["data" => $romaneio]);
}

$parseDate = static function (string $value, string $label): ?string {
        $value = trim($value);
        if ($value === "") {
            return null;
        }
        $date = DateTime::createFromFormat("Y-m-d", $value);
        if (!$date || $date->format("Y-m-d") !== $value) {
            json_response(["error" => "{$label} inválida."], 422);
        }
        return $value;
    };

    $dateFrom = $parseDate((string) ($_GET["date_from"] ?? ""), "Data inicial");
    $dateTo = $parseDate((string) ($_GET["date_to"] ?? ""), "Data final");
    $number = trim((string) ($_GET["number"] ?? ""));
    $expedidor = trim((string) ($_GET["expedidor"] ?? ""));
    $status = strtoupper(trim((string) ($_GET["status"] ?? "")));
    $allowedStatuses = [
        "IMPORTADO",
        "AGUARDANDO",
        "EM_ANDAMENTO",
        "FINALIZADO",
        "CANCELADO",
    ];

    if ($dateFrom !== null && $dateTo !== null && $dateFrom > $dateTo) {
        json_response(
            ["error" => "Data inicial não pode ser posterior à data final."],
            422,
        );
    }
    if ($status !== "" && !in_array($status, $allowedStatuses, true)) {
        json_response(["error" => "Status inválido."], 422);
    }

    $conditions = ["r.company_id = :company_id"];
    $params = ["company_id" => $companyId];
    if ($dateFrom !== null) {
        $conditions[] = "r.scheduled_date >= :date_from";
        $params["date_from"] = $dateFrom;
    }
    if ($dateTo !== null) {
        $conditions[] = "r.scheduled_date <= :date_to";
        $params["date_to"] = $dateTo;
    }
    if ($number !== "") {
        $conditions[] = "r.number LIKE :number";
        $params["number"] = "%" . addcslashes($number, "%_\\") . "%";
    }
    if ($expedidor !== "") {
        $conditions[] = "r.expedidor LIKE :expedidor";
        $params["expedidor"] = "%" . addcslashes($expedidor, "%_\\") . "%";
    }
    if ($status !== "") {
        $conditions[] = "r.status = :status";
        $params["status"] = $status;
    }

    $where = implode(" AND ", $conditions);
    $statement = $pdo->prepare(
        "SELECT r.id, r.number, r.scheduled_date, r.status, r.expedidor,
                (SELECT rt.plate FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS plate,
                (SELECT rt.driver_name FROM romaneio_caminhoes rt WHERE rt.romaneio_id = r.id ORDER BY rt.id LIMIT 1) AS driver_name,
                COUNT(DISTINCT rt.id) AS trucks_count,
                COALESCE((SELECT SUM(ri2.planned_quantity) FROM romaneio_itens ri2 WHERE ri2.romaneio_id = r.id), 0) AS planned_quantity,
                COALESCE((SELECT COUNT(*) FROM leituras l JOIN carregamentos c2 ON c2.id = l.carregamento_id WHERE c2.romaneio_id = r.id AND l.result = 'VALIDO'), 0) AS loaded_quantity,
                (SELECT COUNT(*) FROM ocorrencias o WHERE o.carregamento_id IN (SELECT c3.id FROM carregamentos c3 WHERE c3.romaneio_id = r.id)) AS ocorrencias_count,
                (SELECT c4.id FROM carregamentos c4 WHERE c4.romaneio_id = r.id AND c4.state <> 'FINALIZADO' ORDER BY c4.id DESC LIMIT 1) AS active_loading_id,
                (SELECT c5.state FROM carregamentos c5 WHERE c5.romaneio_id = r.id AND c5.state <> 'FINALIZADO' ORDER BY c5.id DESC LIMIT 1) AS active_state,
                (SELECT e.equipment_code FROM carregamentos c6 JOIN equipamentos e ON e.id = c6.equipment_id WHERE c6.romaneio_id = r.id AND c6.state <> 'FINALIZADO' ORDER BY c6.id DESC LIMIT 1) AS active_equipment
         FROM romaneios r
         LEFT JOIN romaneio_caminhoes rt ON rt.romaneio_id = r.id
         WHERE {$where}
         GROUP BY r.id
         ORDER BY r.scheduled_date DESC, r.id DESC",
    );
    $statement->execute($params);
    $rows = $statement->fetchAll();
    // Sinaliza divergência apenas em cargas finalizadas: contagem diferente do programado ou com ocorrências.
    foreach ($rows as &$row) {
        $finalizado = $row["status"] === "FINALIZADO";
        $row["has_divergence"] =
            $finalizado &&
            ((int) $row["loaded_quantity"] !== (int) $row["planned_quantity"] ||
                (int) $row["ocorrencias_count"] > 0)
                ? 1
                : 0;
    }
    unset($row);
    json_response(["data" => $rows]);
}

if ($_SERVER["REQUEST_METHOD"] === "PATCH") {
    require_csrf();
    if (!in_array($user["role"], ["ADMIN_EMPRESA", "SUPERVISOR"], true)) {
        json_response(["error" => "Somente administração ou supervisão pode cancelar romaneios."], 403);
    }
    $payload = request_json();
    if (($payload["action"] ?? "") === "update") {
        $romaneioId = filter_var($payload["romaneio_id"] ?? null, FILTER_VALIDATE_INT);
        $number = trim((string) ($payload["number"] ?? ""));
        $scheduledDate = trim((string) ($payload["scheduled_date"] ?? ""));
        $plate = strtoupper(trim((string) ($payload["plate"] ?? "")));
        $driverName = trim((string) ($payload["driver_name"] ?? ""));
        $expedidor = trim((string) ($payload["expedidor"] ?? ""));
        if (!$romaneioId || $number === "" || $plate === "") {
            json_response(["error" => "Romaneio, código e placa são obrigatórios."], 422);
        }
        $date = DateTime::createFromFormat("Y-m-d", $scheduledDate);
        if (!$date || $date->format("Y-m-d") !== $scheduledDate) {
            json_response(["error" => "Data do carregamento inválida."], 422);
        }
        if ($scheduledDate < date("Y-m-d")) {
            json_response(["error" => "A data do carregamento não pode ser anterior ao dia atual do PC industrial."], 422);
        }
        $items = $payload["items"] ?? [];
        if (!is_array($items) || $items === []) {
            json_response(["error" => "Informe ao menos um item com produto e quantidade."], 422);
        }
        $normalizedItems = [];
        foreach (array_values($items) as $index => $item) {
            $productId = filter_var($item["product_id"] ?? null, FILTER_VALIDATE_INT);
            $quantity = filter_var($item["quantity"] ?? null, FILTER_VALIDATE_INT);
            if (!$productId || $quantity === false || $quantity < 1) {
                json_response(["error" => "Item " . ($index + 1) . " inválido."], 422);
            }
            if (isset($normalizedItems[$productId])) {
                json_response(["error" => "Produto duplicado nos itens do romaneio."], 422);
            }
            $normalizedItems[$productId] = $quantity;
        }
        try {
            $pdo->beginTransaction();
            $statement = $pdo->prepare(
                "SELECT r.id, r.status, EXISTS(SELECT 1 FROM carregamentos c WHERE c.romaneio_id = r.id) AS has_loading
                 FROM romaneios r WHERE r.id = :id AND r.company_id = :company_id LIMIT 1 FOR UPDATE",
            );
            $statement->execute(["id" => $romaneioId, "company_id" => $companyId]);
            $romaneio = $statement->fetch();
            if (!$romaneio) {
                $pdo->rollBack();
                json_response(["error" => "Romaneio não encontrado."], 404);
            }
            if (!in_array($romaneio["status"], ["IMPORTADO", "AGUARDANDO"], true) || (int) $romaneio["has_loading"] === 1) {
                $pdo->rollBack();
                json_response(["error" => "Só é possível editar um romaneio antes de iniciar o carregamento."], 409);
            }
            $productStatement = $pdo->prepare(
                "SELECT id FROM produtos WHERE id = :id AND company_id = :company_id AND active = 1 LIMIT 1",
            );
            foreach (array_keys($normalizedItems) as $productId) {
                $productStatement->execute(["id" => $productId, "company_id" => $companyId]);
                if (!$productStatement->fetch()) {
                    $pdo->rollBack();
                    json_response(["error" => "Produto não encontrado ou inativo."], 422);
                }
            }
            $truckStatement = $pdo->prepare(
                "SELECT id FROM romaneio_caminhoes WHERE romaneio_id = :romaneio_id ORDER BY id LIMIT 1 FOR UPDATE",
            );
            $truckStatement->execute(["romaneio_id" => $romaneioId]);
            $truck = $truckStatement->fetch();
            if (!$truck) {
                $pdo->rollBack();
                json_response(["error" => "Caminhão do romaneio não encontrado."], 409);
            }
            $pdo->prepare(
                "UPDATE romaneios SET number = :number, scheduled_date = :scheduled_date, expedidor = :expedidor WHERE id = :id",
            )->execute([
                "number" => $number,
                "scheduled_date" => $scheduledDate,
                "expedidor" => $expedidor !== "" ? $expedidor : null,
                "id" => $romaneioId,
            ]);
            $pdo->prepare(
                "UPDATE romaneio_caminhoes SET plate = :plate, driver_name = :driver_name WHERE id = :id",
            )->execute([
                "plate" => $plate,
                "driver_name" => $driverName !== "" ? $driverName : null,
                "id" => $truck["id"],
            ]);
            $pdo->prepare("DELETE FROM romaneio_itens WHERE romaneio_id = :romaneio_id")
                ->execute(["romaneio_id" => $romaneioId]);
            $itemStatement = $pdo->prepare(
                "INSERT INTO romaneio_itens (romaneio_id, product_id, truck_id, planned_quantity) VALUES (:romaneio_id, :product_id, :truck_id, :planned_quantity)",
            );
            foreach ($normalizedItems as $productId => $quantity) {
                $itemStatement->execute([
                    "romaneio_id" => $romaneioId,
                    "product_id" => $productId,
                    "truck_id" => $truck["id"],
                    "planned_quantity" => $quantity,
                ]);
            }
            record_operational_event($pdo, $user, "ROMANEIO_ATUALIZADO", "romaneio", (int) $romaneioId, ["items" => count($normalizedItems)]);
            $pdo->commit();
            json_response(["data" => ["id" => (int) $romaneioId, "status" => $romaneio["status"]]]);
        } catch (PDOException $exception) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ((int) $exception->errorInfo[1] === 1062) {
                json_response(["error" => "Já existe um romaneio com este número."], 409);
            }
            json_response(["error" => "Não foi possível atualizar o romaneio."], 500);
        }
    }
    $romaneioId = filter_var($payload["romaneio_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$romaneioId) {
        json_response(["error" => "Romaneio obrigatório."], 422);
    }
    $pdo->beginTransaction();
    $statement = $pdo->prepare(
        "SELECT r.id, r.status, EXISTS(SELECT 1 FROM carregamentos c WHERE c.romaneio_id = r.id) AS has_loading
         FROM romaneios r WHERE r.id = :id AND r.company_id = :company_id LIMIT 1 FOR UPDATE",
    );
    $statement->execute(["id" => $romaneioId, "company_id" => $companyId]);
    $romaneio = $statement->fetch();
    if (!$romaneio) {
        $pdo->rollBack();
        json_response(["error" => "Romaneio não encontrado."], 404);
    }
    if (in_array($romaneio["status"], ["FINALIZADO", "CANCELADO"], true) || (int) $romaneio["has_loading"] === 1) {
        $pdo->rollBack();
        json_response(["error" => "Só é possível cancelar um romaneio que ainda não iniciou carregamento."], 409);
    }
    $update = $pdo->prepare("UPDATE romaneios SET status = 'CANCELADO' WHERE id = :id AND status NOT IN ('FINALIZADO', 'CANCELADO')");
    $update->execute(["id" => $romaneioId]);
    record_operational_event($pdo, $user, "ROMANEIO_CANCELADO", "romaneio", (int) $romaneioId, ["previous_status" => $romaneio["status"]]);
    $pdo->commit();
    json_response(["data" => ["id" => (int) $romaneioId, "status" => "CANCELADO"]]);
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();
if (!in_array($user["role"], ["ADMIN_EMPRESA", "SUPERVISOR"], true)) {
    json_response(["error" => "Perfil sem permissão para cadastrar romaneio."], 403);
}

$payload = request_json();
$number = trim((string) ($payload["number"] ?? ""));
$scheduledDate = trim((string) ($payload["scheduled_date"] ?? date("Y-m-d")));
$plate = strtoupper(trim((string) ($payload["plate"] ?? "")));
$driverName = trim((string) ($payload["driver_name"] ?? ""));
$expedidor = trim((string) ($payload["expedidor"] ?? ""));

if ($number === "" || $plate === "") {
    json_response(
        ["error" => "Número e placa do caminhão são obrigatórios."],
        422,
    );
}
$date = DateTime::createFromFormat("Y-m-d", $scheduledDate);
if (!$date || $date->format("Y-m-d") !== $scheduledDate) {
    json_response(["error" => "Data do carregamento inválida."], 422);
}
if ($scheduledDate < date("Y-m-d")) {
    json_response(
        ["error" => "A data do carregamento não pode ser anterior ao dia atual do PC industrial."],
        422,
    );
}

// Itens: formato novo (items[]) ou legado (product_code + planned_quantity).
$items = $payload["items"] ?? null;
if (!is_array($items) || $items === []) {
    $legacyCode = trim((string) ($payload["product_code"] ?? ""));
    $legacyQuantity = filter_var(
        $payload["planned_quantity"] ?? null,
        FILTER_VALIDATE_INT,
    );
    if (
        $legacyCode !== "" &&
        $legacyQuantity !== false &&
        $legacyQuantity >= 1
    ) {
        $items = [
            ["product_code" => $legacyCode, "quantity" => $legacyQuantity],
        ];
    }
}
if (!is_array($items) || $items === []) {
    json_response(
        ["error" => "Informe ao menos um item com produto e quantidade."],
        422,
    );
}

$normalizedItems = [];
foreach (array_values($items) as $index => $item) {
    if (!is_array($item)) {
        json_response(["error" => "Item " . ($index + 1) . " inválido."], 422);
    }
    $quantity = filter_var(
        $item["quantity"] ?? ($item["planned_quantity"] ?? null),
        FILTER_VALIDATE_INT,
    );
    if ($quantity === false || $quantity < 1) {
        json_response(
            ["error" => "Item " . ($index + 1) . ": quantidade inválida."],
            422,
        );
    }
    $productId = filter_var($item["product_id"] ?? null, FILTER_VALIDATE_INT);
    $rawCode = trim(
        (string) ($item["product_code"] ??
            ($item["code"] ?? ($item["barcode"] ?? ""))),
    );
    if (!$productId && $rawCode === "") {
        json_response(
            ["error" => "Item " . ($index + 1) . ": produto não informado."],
            422,
        );
    }
    $productKey = $productId ? "id:" . $productId : "code:" . $rawCode;
    if (isset($normalizedItems[$productKey])) {
        json_response(
            ["error" => "Produto duplicado nos itens do romaneio."],
            422,
        );
    }
    $normalizedItems[$productKey] = [
        "product_id" => $productId,
        "key" => $productKey,
        "quantity" => $quantity,
    ];
}

try {
    $pdo->beginTransaction();

    $resolved = [];
    foreach ($normalizedItems as $item) {
        if ($item["product_id"]) {
            $productStatement = $pdo->prepare(
                "SELECT id, code, name FROM produtos WHERE id = :id AND company_id = :company_id AND active = 1 LIMIT 1",
            );
            $productStatement->execute([
                "id" => $item["product_id"],
                "company_id" => $companyId,
            ]);
        } else {
            $code = substr((string) $item["key"], 5);
            $productStatement = $pdo->prepare(
                "SELECT id, code, name FROM produtos WHERE company_id = :company_id AND active = 1 AND (code = :code OR id IN (SELECT product_id FROM codigos_produtos WHERE barcode = :barcode)) LIMIT 1",
            );
            $productStatement->execute([
                "company_id" => $companyId,
                "code" => $code,
                "barcode" => $code,
            ]);
        }
        $product = $productStatement->fetch();
        if (!$product) {
            $pdo->rollBack();
            json_response(
                [
                    "error" =>
                        "Produto não encontrado ou inativo: " .
                        substr((string) $item["key"], 5),
                ],
                422,
            );
        }
        $resolved[] = ["product" => $product, "quantity" => $item["quantity"]];
    }

    $romaneioStatement = $pdo->prepare(
        'INSERT INTO romaneios (company_id, number, scheduled_date, status, expedidor) VALUES (:company_id, :number, :scheduled_date, \'AGUARDANDO\', :expedidor)',
    );
    $romaneioStatement->execute([
        "company_id" => $companyId,
        "number" => $number,
        "scheduled_date" => $scheduledDate,
        "expedidor" => $expedidor !== "" ? $expedidor : null,
    ]);
    $romaneioId = (int) $pdo->lastInsertId();

    $truckStatement = $pdo->prepare(
        "INSERT INTO romaneio_caminhoes (romaneio_id, plate, driver_name) VALUES (:romaneio_id, :plate, :driver_name)",
    );
    $truckStatement->execute([
        "romaneio_id" => $romaneioId,
        "plate" => $plate,
        "driver_name" => $driverName !== "" ? $driverName : null,
    ]);
    $truckId = (int) $pdo->lastInsertId();

    $itemStatement = $pdo->prepare(
        "INSERT INTO romaneio_itens (romaneio_id, product_id, truck_id, planned_quantity) VALUES (:romaneio_id, :product_id, :truck_id, :planned_quantity)",
    );
    foreach ($resolved as $entry) {
        $itemStatement->execute([
            "romaneio_id" => $romaneioId,
            "product_id" => $entry["product"]["id"],
            "truck_id" => $truckId,
            "planned_quantity" => $entry["quantity"],
        ]);
    }
    $pdo->commit();
    record_operational_event(
        $pdo,
        $user,
        "ROMANEIO_CRIADO",
        "romaneio",
        $romaneioId,
        [
            "number" => $number,
            "truck_id" => $truckId,
            "items" => count($resolved),
        ],
    );

    json_response(
        [
            "data" => [
                "id" => $romaneioId,
                "number" => $number,
                "truck_id" => $truckId,
                "items" => count($resolved),
                "status" => "AGUARDANDO",
            ],
        ],
        201,
    );
} catch (PDOException $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if ((int) $exception->errorInfo[1] === 1062) {
        json_response(
            ["error" => "Já existe um romaneio com este número."],
            409,
        );
    }
    json_response(["error" => "Não foi possível salvar o romaneio."], 500);
}
