<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$usuarioAtor = exigir_sessao_usuario();
if ($usuarioAtor["company_id"] === null) {
    responder_json(["error" => "Usuário sem empresa vinculada."], 403);
}
$pdo = obter_conexao_banco();

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $statement = obter_conexao_banco()->prepare(
        'SELECT c.id, c.state, c.equipment_id, c.started_at, c.finished_at,
                r.number AS romaneio_number, rt.plate, e.equipment_code,
                COALESCE((SELECT SUM(ri.planned_quantity) FROM romaneio_itens ri WHERE ri.romaneio_id = c.romaneio_id AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)), 0) AS planned_quantity,
                COALESCE(c.leituras_validas, 0) AS valid_readings
         FROM carregamentos c
         JOIN romaneios r ON r.id = c.romaneio_id
         JOIN romaneio_caminhoes rt ON rt.id = c.truck_id
         LEFT JOIN equipamentos e ON e.id = c.equipment_id
         WHERE c.company_id = :company_id
         ORDER BY c.id DESC',
    );
    $statement->execute(["company_id" => $usuarioAtor["company_id"]]);
    $rows = $statement->fetchAll();
    foreach ($rows as &$row) {
        $row["items"] = [];
    }
    unset($row);

    if ($rows) {
        $loadingIds = array_values(array_unique(array_map(
            static fn (array $row): int => (int) $row["id"],
            $rows,
        )));
        $placeholders = [];
        $params = ["company_id" => (int) $usuarioAtor["company_id"]];
        foreach ($loadingIds as $index => $loadingId) {
            $name = "loading_id_{$index}";
            $placeholders[] = ":{$name}";
            $params[$name] = $loadingId;
        }
        $itemsStatement = $pdo->prepare(
            "SELECT c.id AS loading_id, ri.product_id, p.name, p.code,
                    SUM(ri.planned_quantity) AS planned_quantity,
                    (SELECT COUNT(*)
                     FROM leituras l
                     WHERE l.carregamento_id = c.id
                       AND l.product_id = ri.product_id
                       AND l.result = 'VALIDO') AS loaded_quantity
             FROM carregamentos c
             JOIN romaneio_itens ri
               ON ri.romaneio_id = c.romaneio_id
              AND (ri.truck_id = c.truck_id OR ri.truck_id IS NULL)
             JOIN produtos p ON p.id = ri.product_id
             WHERE c.company_id = :company_id
               AND c.id IN (" . implode(", ", $placeholders) . ")
             GROUP BY c.id, ri.product_id, p.name, p.code
             ORDER BY c.id DESC, ri.product_id",
        );
        $itemsStatement->execute($params);
        $itemsByLoading = [];
        foreach ($itemsStatement->fetchAll() as $item) {
            $planned = (int) $item["planned_quantity"];
            $loaded = (int) $item["loaded_quantity"];
            $itemsByLoading[(int) $item["loading_id"]][] = [
                "product_id" => (int) $item["product_id"],
                "name" => $item["name"],
                "code" => $item["code"],
                "planned_quantity" => $planned,
                "loaded_quantity" => $loaded,
                "remaining_quantity" => max(0, $planned - $loaded),
            ];
        }
        foreach ($rows as &$row) {
            $row["items"] = $itemsByLoading[(int) $row["id"]] ?? [];
        }
        unset($row);
    }
    responder_json(["data" => $rows]);
}

if ($_SERVER["REQUEST_METHOD"] === "PATCH") {
    exigir_csrf();
    if (!in_array($usuarioAtor["role"], ["ADMIN_EMPRESA", "SUPERVISOR"], true)) {
        responder_json(["error" => "Perfil sem permissão para trocar a Dala."], 403);
    }
    validar_licenca_ativa(obter_conexao_banco(), (int) $usuarioAtor["company_id"]);
    $payload = ler_json_da_requisicao();
    $loadingId = filter_var($payload["carregamento_id"] ?? null, FILTER_VALIDATE_INT);
    $equipmentId = filter_var($payload["equipment_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$loadingId || !$equipmentId) {
        responder_json(["error" => "Carregamento e nova Dala são obrigatórios."], 422);
    }

    try {
        $pdo->beginTransaction();
        $loading = $pdo->prepare(
            "SELECT id, state, equipment_id, remote_carregamento_id
             FROM carregamentos
             WHERE id = :id AND company_id = :company_id
             LIMIT 1 FOR UPDATE",
        );
        $loading->execute([
            "id" => $loadingId,
            "company_id" => $usuarioAtor["company_id"],
        ]);
        $current = $loading->fetch();
        if (!$current || $current["state"] === "FINALIZADO" || $current["equipment_id"] !== null) {
            $pdo->rollBack();
            responder_json(["error" => "Carregamento não está aguardando uma Dala."], 409);
        }
        $equipment = $pdo->prepare(
            "SELECT id, equipment_code FROM equipamentos
             WHERE id = :id AND company_id = :company_id LIMIT 1 FOR UPDATE",
        );
        $equipment->execute([
            "id" => $equipmentId,
            "company_id" => $usuarioAtor["company_id"],
        ]);
        $target = $equipment->fetch();
        if (!$target) {
            $pdo->rollBack();
            responder_json(["error" => "Nova Dala não encontrada para esta empresa."], 404);
        }
        $conflict = $pdo->prepare(
            "SELECT id FROM carregamentos
             WHERE company_id = :company_id AND id <> :id
               AND state <> 'FINALIZADO' AND equipment_id = :equipment_id
             LIMIT 1 FOR UPDATE",
        );
        $conflict->execute([
            "company_id" => $usuarioAtor["company_id"],
            "id" => $loadingId,
            "equipment_id" => $equipmentId,
        ]);
        if ($conflict->fetch()) {
            $pdo->rollBack();
            responder_json(["error" => "A nova Dala já possui um carregamento em andamento."], 409);
        }
        $update = $pdo->prepare(
            "UPDATE carregamentos
             SET equipment_id = :equipment_id, state = 'AGUARDANDO', started_at = NULL
             WHERE id = :id AND company_id = :company_id",
        );
        $update->execute([
            "equipment_id" => $equipmentId,
            "id" => $loadingId,
            "company_id" => $usuarioAtor["company_id"],
        ]);
        record_operational_event(
            $pdo,
            $usuarioAtor,
            "CARREGAMENTO_DALA_VINCULADO",
            "carregamento",
            (int) $loadingId,
            [
                "equipment_id" => $equipmentId,
                "equipment_code" => $target["equipment_code"],
                "previous_equipment_id" => $current["equipment_id"] === null ? null : (int) $current["equipment_id"],
                "remote_carregamento_id" => $current["remote_carregamento_id"] === null ? null : (int) $current["remote_carregamento_id"],
                "state" => "AGUARDANDO",
            ],
        );
        $pdo->commit();
        responder_json(["data" => [
            "id" => (int) $loadingId,
            "equipment_id" => (int) $equipmentId,
            "equipment_code" => $target["equipment_code"],
            "state" => "AGUARDANDO",
        ]]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log("Loading equipment reassignment failed: " . $exception->getMessage());
        responder_json(["error" => "Não foi possível vincular a nova Dala."], 500);
    }
}

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    responder_json(["error" => "Método não permitido."], 405);
}
if (is_file(dirname(__DIR__, 2) . "/armazenamento/.maintenance")) {
    responder_json(["error" => "Atualização do sistema em andamento; tente preparar o carregamento novamente em instantes."], 503);
}
exigir_csrf();
if (!in_array($usuarioAtor["role"], ["ADMIN_EMPRESA", "SUPERVISOR"], true)) {
    responder_json(
        [
            "error" =>
            "A preparação do carregamento é permitida somente para administração ou supervisão.",
        ],
        403,
    );
}
validar_licenca_ativa(obter_conexao_banco(), (int) $usuarioAtor["company_id"]);

$payload = ler_json_da_requisicao();
$romaneioId = filter_var($payload["romaneio_id"] ?? null, FILTER_VALIDATE_INT);
$truckId = filter_var($payload["truck_id"] ?? null, FILTER_VALIDATE_INT);
$equipmentId = filter_var(
    $payload["equipment_id"] ?? ($payload["esteira_id"] ?? null),
    FILTER_VALIDATE_INT,
);
if (!$romaneioId || !$truckId || !$equipmentId) {
    responder_json(
        ["error" => "Romaneio, caminhão e esteira são obrigatórios."],
        422,
    );
}

$statement = $pdo->prepare(
    'SELECT r.id AS romaneio_id, rt.id AS truck_id, e.id AS equipment_id
     FROM romaneios r
     JOIN romaneio_caminhoes rt ON rt.romaneio_id = r.id
     JOIN equipamentos e ON e.id = :equipment_id AND e.company_id = r.company_id
     WHERE r.id = :romaneio_id AND rt.id = :truck_id AND r.company_id = :company_id LIMIT 1',
);
$statement->execute([
    "equipment_id" => $equipmentId,
    "romaneio_id" => $romaneioId,
    "truck_id" => $truckId,
    "company_id" => $usuarioAtor["company_id"],
]);
$valid = $statement->fetch();
if (!$valid) {
    responder_json(
        [
            "error" =>
            "Romaneio, caminhão ou equipamento não pertence à empresa.",
        ],
        422,
    );
}

try {
    $pdo->beginTransaction();
    $available = $pdo->prepare(
        "SELECT r.status
         FROM romaneios r
         WHERE r.id = :romaneio_id AND r.company_id = :company_id FOR UPDATE",
    );
    $available->execute([
        "romaneio_id" => $romaneioId,
        "company_id" => $usuarioAtor["company_id"],
    ]);
    $romaneio = $available->fetch();
    if (
        !$romaneio ||
        in_array($romaneio["status"], ["FINALIZADO", "CANCELADO"], true)
    ) {
        $pdo->rollBack();
        responder_json(
            [
                "error" =>
                "Este romaneio não está disponível para novo carregamento.",
            ],
            409,
        );
    }
    $conflict = $pdo->prepare(
        "SELECT id FROM carregamentos
         WHERE company_id = :company_id AND state <> 'FINALIZADO'
           AND (equipment_id = :equipment_id OR (romaneio_id = :romaneio_id AND truck_id = :truck_id))
         LIMIT 1 FOR UPDATE",
    );
    $conflict->execute([
        "company_id" => $usuarioAtor["company_id"],
        "equipment_id" => $equipmentId,
        "romaneio_id" => $romaneioId,
        "truck_id" => $truckId,
    ]);
    if ($conflict->fetch()) {
        $pdo->rollBack();
        responder_json(
            [
                "error" =>
                "A Dala ou este caminhão já possui um carregamento em andamento.",
            ],
            409,
        );
    }
    $insert = $pdo->prepare(
        'INSERT INTO carregamentos (company_id, equipment_id, romaneio_id, truck_id, state, started_at) VALUES (:company_id, :equipment_id, :romaneio_id, :truck_id, \'PREPARANDO\', NOW())',
    );
    $insert->execute([
        "company_id" => $usuarioAtor["company_id"],
        "equipment_id" => $equipmentId,
        "romaneio_id" => $romaneioId,
        "truck_id" => $truckId,
    ]);
    $loadingId = (int) $pdo->lastInsertId();
    $pdo->prepare(
        "UPDATE romaneios SET status = 'EM_ANDAMENTO' WHERE id = :id",
    )->execute(["id" => $romaneioId]);
    record_operational_event(
        $pdo,
        $usuarioAtor,
        "CARREGAMENTO_PREPARADO",
        "carregamento",
        $loadingId,
        [
            "romaneio_id" => $romaneioId,
            "truck_id" => $truckId,
            "equipment_id" => $equipmentId,
        ],
    );
    $pdo->commit();
    responder_json(
        ["data" => ["id" => $loadingId, "state" => "PREPARANDO"]],
        201,
    );
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log("Loading preparation failed: " . $exception->getMessage());
    responder_json(
        ["error" => "Não foi possível preparar o carregamento."],
        500,
    );
}
