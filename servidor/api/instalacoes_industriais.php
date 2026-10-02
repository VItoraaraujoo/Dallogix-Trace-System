<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$actor = require_session_user();
$isMaster = ($actor["role"] ?? "") === "ADMIN_DALLOGIX";
$method = strtoupper((string) ($_SERVER["REQUEST_METHOD"] ?? "GET"));
$pdo = db();

$resolveCompanyId = static function (mixed $raw, bool $master, array $user): int {
    if ($master) {
        $companyId = filter_var($raw, FILTER_VALIDATE_INT);
        if (!$companyId || (int) $companyId < 1) {
            json_response(["error" => "Empresa não informada."], 422);
        }
        return (int) $companyId;
    }
    $companyId = (int) ($user["company_id"] ?? 0);
    if ($companyId < 1) {
        json_response(["error" => "Usuário sem empresa vinculada."], 403);
    }
    if ($raw !== null && $raw !== "" && (int) $raw !== $companyId) {
        json_response(["error" => "Perfil sem permissão para consultar esta empresa."], 403);
    }
    return $companyId;
};

if ($method === "GET") {
    if (!$isMaster && !in_array(($actor["role"] ?? ""), ["ADMIN_EMPRESA", "SUPERVISOR"], true)) {
        json_response(["error" => "Somente o administrador e o supervisor da empresa podem consultar seus PCs industriais."], 403);
    }
    $rawCompanyId = $_GET["company_id"] ?? null;
    $companyId = $resolveCompanyId($rawCompanyId, $isMaster, $actor);
    $pcSignalLimitSeconds = max(5, min(300, (int) (getenv("HEALTH_DEVICE_STALE_SECONDS") ?: 30)));
    $statement = $pdo->prepare(
        "SELECT p.id, p.company_id, p.equipment_id, p.name,
                CASE WHEN p.status = 'ONLINE' AND (p.last_seen_at IS NULL
                     OR p.last_seen_at < DATE_SUB(NOW(3), INTERVAL {$pcSignalLimitSeconds} SECOND))
                     THEN 'OFFLINE' ELSE p.status END AS status,
                p.last_seen_at,
                p.activated_at, (p.sync_token_hash IS NOT NULL) AS activated,
                p.activation_code_preview, p.activation_code_created_at,
                p.activation_code_expires_at,
                (p.activation_code IS NOT NULL AND p.activation_code_used_at IS NULL
                  AND p.activation_code_expires_at > NOW()) AS activation_code_pending,
                CASE WHEN p.activation_code_used_at IS NULL AND p.activation_code_expires_at > NOW()
                     THEN p.activation_code ELSE NULL END AS activation_code,
                e.name AS equipment_name, e.equipment_code
         FROM instalacoes_industriais p
         LEFT JOIN equipamentos e ON e.id = p.equipment_id AND e.company_id = p.company_id
         WHERE p.company_id = :company_id
         ORDER BY p.id"
    );
    $statement->execute(["company_id" => $companyId]);
    $installations = $statement->fetchAll();
    foreach ($installations as &$installation) {
        $installation["id"] = (int) $installation["id"];
        $installation["company_id"] = (int) $installation["company_id"];
        $installation["equipment_id"] = $installation["equipment_id"] === null
            ? null
            : (int) $installation["equipment_id"];
        $installation["activation_code_pending"] = (bool) $installation["activation_code_pending"];
        $installation["activated"] = (bool) $installation["activated"];
        if (!$isMaster || !$installation["activation_code_pending"]) {
            $installation["activation_code"] = null;
        }
    }
    unset($installation);

    $equipmentStatement = $pdo->prepare(
        "SELECT e.id, e.name, e.equipment_code, p.id AS industrial_pc_id,
                p.name AS industrial_pc_name
         FROM equipamentos e
         LEFT JOIN instalacoes_industriais p ON p.equipment_id = e.id AND p.company_id = e.company_id
         WHERE e.company_id = :company_id
         ORDER BY e.name, e.equipment_code"
    );
    $equipmentStatement->execute(["company_id" => $companyId]);
    $equipmentOptions = array_map(static function (array $row): array {
        return [
            "id" => (int) $row["id"],
            "name" => (string) $row["name"],
            "equipment_code" => (string) $row["equipment_code"],
            "industrial_pc_id" => $row["industrial_pc_id"] === null
                ? null
                : (int) $row["industrial_pc_id"],
            "industrial_pc_name" => $row["industrial_pc_name"],
        ];
    }, $equipmentStatement->fetchAll());

    json_response(["data" => [
        "installations" => $installations,
        "equipment_options" => $equipmentOptions,
    ]]);
}

if ($method !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
if (!$isMaster) {
    json_response(["error" => "Somente o perfil Master pode gerenciar acessos de PCs industriais."], 403);
}
require_csrf();
$payload = request_json();
$action = strtolower(trim((string) ($payload["action"] ?? "")));

if ($action === "create") {
    $companyId = $resolveCompanyId($payload["company_id"] ?? null, true, $actor);
    $name = trim((string) ($payload["name"] ?? ""));
    $equipmentId = filter_var($payload["equipment_id"] ?? null, FILTER_VALIDATE_INT);
    if ($name === "" || mb_strlen($name) > 160) {
        json_response(["error" => "Informe um nome de até 160 caracteres para o PC industrial."], 422);
    }
    if (($payload["equipment_id"] ?? null) !== null && ($payload["equipment_id"] ?? "") !== "" && $equipmentId === false) {
        json_response(["error" => "Dala inválida."], 422);
    }
    $equipmentId = $equipmentId === false || $equipmentId === null ? null : (int) $equipmentId;
    $pdo->beginTransaction();
    try {
        $company = $pdo->prepare("SELECT id FROM empresas WHERE id = :id AND archived_at IS NULL LIMIT 1 FOR UPDATE");
        $company->execute(["id" => $companyId]);
        if (!$company->fetchColumn()) {
            throw new RuntimeException("Empresa não encontrada ou arquivada.");
        }
        if ($equipmentId !== null) {
            $equipment = $pdo->prepare(
                "SELECT id FROM equipamentos WHERE id = :id AND company_id = :company_id LIMIT 1 FOR UPDATE"
            );
            $equipment->execute(["id" => $equipmentId, "company_id" => $companyId]);
            if (!$equipment->fetchColumn()) {
                throw new RuntimeException("A Dala selecionada não pertence a esta empresa.");
            }
            $assigned = $pdo->prepare("SELECT id FROM instalacoes_industriais WHERE equipment_id = :equipment_id LIMIT 1");
            $assigned->execute(["equipment_id" => $equipmentId]);
            if ($assigned->fetchColumn()) {
                throw new RuntimeException("Esta Dala já está vinculada a outro PC industrial.");
            }
        }
        $insert = $pdo->prepare(
            "INSERT INTO instalacoes_industriais (company_id, equipment_id, name, created_by)
             VALUES (:company_id, :equipment_id, :name, :created_by)"
        );
        $insert->execute([
            "company_id" => $companyId,
            "equipment_id" => $equipmentId,
            "name" => $name,
            "created_by" => $actor["id"],
        ]);
        $installationId = (int) $pdo->lastInsertId();
        registrar_evento_operacional($pdo, $actor, "PC_INDUSTRIAL_CADASTRADO", "instalacao_industrial", $installationId, [
            "company_id" => $companyId,
            "equipment_id" => $equipmentId,
            "name" => $name,
        ]);
        $pdo->commit();
        json_response(["data" => ["id" => $installationId]], 201);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($exception instanceof PDOException && (int) ($exception->errorInfo[1] ?? 0) === 1062) {
            json_response(["error" => "A Dala já está vinculada a outro PC industrial."], 409);
        }
        json_response(["error" => $exception->getMessage()], 409);
    }
}

if ($action === "assign_equipment") {
    $installationId = filter_var($payload["installation_id"] ?? null, FILTER_VALIDATE_INT);
    $equipmentId = filter_var($payload["equipment_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$installationId || ($payload["equipment_id"] ?? null) === "" || $equipmentId === false) {
        json_response(["error" => "Selecione uma Dala válida."], 422);
    }
    $installationId = (int) $installationId;
    $equipmentId = (int) $equipmentId;
    $pdo->beginTransaction();
    try {
        $installation = $pdo->prepare(
            "SELECT company_id, equipment_id, sync_token_hash FROM instalacoes_industriais
             WHERE id = :id LIMIT 1 FOR UPDATE"
        );
        $installation->execute(["id" => $installationId]);
        $row = $installation->fetch();
        if (!$row) {
            throw new RuntimeException("PC industrial não encontrado.");
        }
        if ($row["sync_token_hash"] !== null && $row["equipment_id"] !== null) {
            throw new RuntimeException("Este PC já foi ativado e vinculado. Não é possível trocar a Dala.");
        }
        $equipment = $pdo->prepare(
            "SELECT id FROM equipamentos WHERE id = :id AND company_id = :company_id LIMIT 1 FOR UPDATE"
        );
        $equipment->execute(["id" => $equipmentId, "company_id" => $row["company_id"]]);
        if (!$equipment->fetchColumn()) {
            throw new RuntimeException("A Dala selecionada não pertence a esta empresa.");
        }
        $assigned = $pdo->prepare(
            "SELECT id FROM instalacoes_industriais WHERE equipment_id = :equipment_id AND id <> :id LIMIT 1"
        );
        $assigned->execute(["equipment_id" => $equipmentId, "id" => $installationId]);
        if ($assigned->fetchColumn()) {
            throw new RuntimeException("Esta Dala já está vinculada a outro PC industrial.");
        }
        $update = $pdo->prepare(
            "UPDATE instalacoes_industriais SET equipment_id = :equipment_id, auto_link_first_dala = 0
             WHERE id = :id AND company_id = :company_id"
        );
        $update->execute([
            "equipment_id" => $equipmentId,
            "id" => $installationId,
            "company_id" => $row["company_id"],
        ]);
        registrar_evento_operacional($pdo, $actor, "PC_INDUSTRIAL_DALA_VINCULADA", "instalacao_industrial", $installationId, [
            "company_id" => (int) $row["company_id"],
            "equipment_id" => $equipmentId,
        ]);
        $pdo->commit();
        json_response(["data" => ["id" => $installationId, "equipment_id" => $equipmentId]]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if ($exception instanceof PDOException && (int) ($exception->errorInfo[1] ?? 0) === 1062) {
            json_response(["error" => "Esta Dala já está vinculada a outro PC industrial."], 409);
        }
        json_response(["error" => $exception->getMessage()], 409);
    }
}

if ($action === "revoke_access") {
    $installationId = filter_var($payload["installation_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$installationId || (int) $installationId < 1) {
        json_response(["error" => "PC industrial não informado."], 422);
    }
    $installationId = (int) $installationId;
    $pdo->beginTransaction();
    try {
        $installation = $pdo->prepare(
            "SELECT company_id, equipment_id, sync_token_hash
             FROM instalacoes_industriais WHERE id = :id LIMIT 1 FOR UPDATE",
        );
        $installation->execute(["id" => $installationId]);
        $row = $installation->fetch();
        if (!$row) {
            throw new RuntimeException("PC industrial não encontrado.");
        }
        if ($row["sync_token_hash"] === null) {
            throw new RuntimeException("Este PC industrial já está sem acesso ativo.");
        }
        $revoke = $pdo->prepare(
            "UPDATE instalacoes_industriais
             SET sync_token_hash = NULL, activated_at = NULL,
                 activation_code = NULL, activation_code_hash = NULL,
                 activation_code_preview = NULL, activation_code_created_at = NULL,
                 activation_code_expires_at = NULL, activation_code_used_at = NULL,
                 status = 'DESCONHECIDO', last_seen_at = NULL, details = NULL
             WHERE id = :id AND company_id = :company_id",
        );
        $revoke->execute([
            "id" => $installationId,
            "company_id" => (int) $row["company_id"],
        ]);
        registrar_evento_operacional($pdo, $actor, "ACESSO_PC_INDUSTRIAL_REVOGADO", "instalacao_industrial", $installationId, [
            "company_id" => (int) $row["company_id"],
            "equipment_id" => $row["equipment_id"] === null ? null : (int) $row["equipment_id"],
        ]);
        $markDelivered = $pdo->prepare(
            "UPDATE fila_sincronizacao q
             JOIN (
               SELECT company_id, MIN(last_delivered_queue_id) AS acknowledged_through
               FROM instalacoes_industriais
               WHERE company_id = :installation_company_id
                 AND sync_token_hash IS NOT NULL AND equipment_id IS NOT NULL
               GROUP BY company_id
             ) acknowledged ON acknowledged.company_id = q.company_id
               AND q.id <= acknowledged.acknowledged_through
             SET q.status = 'ENVIADO', q.last_error = NULL, q.processing_started_at = NULL
             WHERE q.company_id = :queue_company_id
               AND q.status IN ('PENDENTE', 'ERRO')",
        );
        $markDelivered->execute([
            "installation_company_id" => (int) $row["company_id"],
            "queue_company_id" => (int) $row["company_id"],
        ]);
        $pdo->commit();
        json_response(["data" => ["id" => $installationId, "revoked" => true]]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        json_response(["error" => $exception->getMessage()], 409);
    }
}

if ($action === "generate_activation_code") {
    $installationId = filter_var($payload["installation_id"] ?? null, FILTER_VALIDATE_INT);
    if (!$installationId || (int) $installationId < 1) {
        json_response(["error" => "PC industrial não informado."], 422);
    }
    $installationId = (int) $installationId;
    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            "SELECT p.id, p.company_id, p.equipment_id, p.name, p.sync_token_hash,
                    p.activation_code, p.activation_code_used_at,
                    (p.activation_code_expires_at IS NOT NULL AND p.activation_code_expires_at > NOW()) AS code_unexpired,
                    c.name AS company_name, c.login_domain, c.archived_at,
                    (SELECT l.status FROM licencas l WHERE l.company_id = c.id ORDER BY l.id DESC LIMIT 1) AS license_status
             FROM instalacoes_industriais p
             JOIN empresas c ON c.id = p.company_id
             WHERE p.id = :id LIMIT 1 FOR UPDATE"
        );
        $statement->execute(["id" => $installationId]);
        $row = $statement->fetch();
        if (!$row || $row["archived_at"] !== null) {
            throw new RuntimeException("Empresa ou PC industrial não encontrado ou arquivado.");
        }
        if (($row["license_status"] ?? "") !== "ATIVA") {
            throw new RuntimeException("Ative a licença da empresa antes de gerar o código do PC.");
        }
        if ($row["sync_token_hash"] !== null) {
            throw new RuntimeException("Este PC já está ativado. Gere um novo acesso somente após revogar o PC atual.");
        }
        $pending = trim((string) ($row["activation_code"] ?? "")) !== ""
            && empty($row["activation_code_used_at"])
            && (bool) $row["code_unexpired"];
        if ($pending) {
            $pdo->commit();
            json_response(["data" => [
                "id" => $installationId,
                "name" => $row["name"],
                "company_name" => $row["company_name"],
                "login_domain" => $row["login_domain"],
                "activation_code" => $row["activation_code"],
            ]]);
        }
        $activation = gerar_codigo_ativacao_empresa();
        $update = $pdo->prepare(
            "UPDATE instalacoes_industriais
             SET activation_code = :code, activation_code_hash = :code_hash,
                 activation_code_preview = :preview, activation_code_created_at = NOW(),
                 activation_code_expires_at = DATE_ADD(NOW(), INTERVAL 7 DAY),
                 activation_code_used_at = NULL
             WHERE id = :id AND sync_token_hash IS NULL"
        );
        $update->execute([
            "code" => $activation["code"],
            "code_hash" => $activation["hash"],
            "preview" => $activation["preview"],
            "id" => $installationId,
        ]);
        if ($update->rowCount() !== 1) {
            throw new RuntimeException("Não foi possível liberar este PC industrial para ativação.");
        }
        registrar_evento_operacional($pdo, $actor, "CODIGO_PC_INDUSTRIAL_GERADO", "instalacao_industrial", $installationId, [
            "company_id" => (int) $row["company_id"],
            "equipment_id" => (int) $row["equipment_id"],
        ]);
        $pdo->commit();
        json_response(["data" => [
            "id" => $installationId,
            "name" => $row["name"],
            "company_name" => $row["company_name"],
            "login_domain" => $row["login_domain"],
            "activation_code" => $activation["code"],
        ]], 201);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        json_response(["error" => $exception->getMessage()], 409);
    }
}

if ($action === "rename") {
    $installationId = filter_var($payload["installation_id"] ?? null, FILTER_VALIDATE_INT);
    $name = trim((string) ($payload["name"] ?? ""));
    if (!$installationId || $name === "" || mb_strlen($name) > 160) {
        json_response(["error" => "Informe o PC industrial e um nome de até 160 caracteres."], 422);
    }
    $update = $pdo->prepare("UPDATE instalacoes_industriais SET name = :name WHERE id = :id");
    $update->execute(["name" => $name, "id" => (int) $installationId]);
    if ($update->rowCount() !== 1) {
        json_response(["error" => "PC industrial não encontrado ou nome sem alterações."], 404);
    }
    registrar_evento_operacional($pdo, $actor, "PC_INDUSTRIAL_RENOMEADO", "instalacao_industrial", (int) $installationId, ["name" => $name]);
    json_response(["data" => ["id" => (int) $installationId, "name" => $name]]);
}

json_response(["error" => "Ação de PC industrial inválida."], 422);
