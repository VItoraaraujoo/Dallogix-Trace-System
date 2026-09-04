<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$actor = require_session_user();
$isPlatformAdmin = $actor["role"] === "ADMIN_DALLOGIX";
$isCompanyAdmin = $actor["role"] === "ADMIN_EMPRESA";
if (!$isPlatformAdmin && !$isCompanyAdmin) {
    json_response(
        ["error" => "Perfil sem permissão para gerenciar logins."],
        403,
    );
}

$resolveCompanyId = static function (array $input) use (
    $actor,
    $isPlatformAdmin,
): int {
    $requested = filter_var($input["company_id"] ?? null, FILTER_VALIDATE_INT);
    if ($isPlatformAdmin) {
        if (!$requested) {
            json_response(["error" => "Selecione a empresa do login."], 422);
        }
        return (int) $requested;
    }
    if ($actor["company_id"] === null) {
        json_response(["error" => "Administrador sem empresa vinculada."], 403);
    }
    return (int) $actor["company_id"];
};

$pdo = db();
if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $companyId = $resolveCompanyId($_GET);
    $exists = $pdo->prepare("SELECT id FROM empresas WHERE id = :id");
    $exists->execute(["id" => $companyId]);
    if (!$exists->fetch()) {
        json_response(["error" => "Empresa não encontrada."], 404);
    }
    $statement = $pdo->prepare(
        "SELECT id, name, email, role, active, created_at, updated_at FROM usuarios WHERE company_id = :company_id ORDER BY name",
    );
    $statement->execute(["company_id" => $companyId]);
    json_response(["data" => $statement->fetchAll()]);
}

if ($_SERVER["REQUEST_METHOD"] === "PUT") {
    require_csrf();
    $payload = request_json();
    $companyId = $resolveCompanyId($payload);
    $id = filter_var($payload["id"] ?? null, FILTER_VALIDATE_INT);
    $name = trim((string) ($payload["name"] ?? ""));
    $role = strtoupper(trim((string) ($payload["role"] ?? "")));
    $active = filter_var(
        $payload["active"] ?? null,
        FILTER_VALIDATE_BOOLEAN,
        FILTER_NULL_ON_FAILURE,
    );
    $password = (string) ($payload["password"] ?? "");
    $allowedRoles = $isPlatformAdmin
        ? ["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"]
        : ["SUPERVISOR", "USUARIO"];
    if (
        !$id ||
        $name === "" ||
        mb_strlen($name) > 160 ||
        !in_array($role, $allowedRoles, true) ||
        $active === null ||
        ($password !== "" && strlen($password) < 10)
    ) {
        json_response(
            [
                "error" =>
                "Dados de atualização inválidos. A nova senha deve ter ao menos 10 caracteres.",
            ],
            422,
        );
    }
    $target = $pdo->prepare(
        "SELECT id, role, active FROM usuarios WHERE id = :id AND company_id = :company_id LIMIT 1",
    );
    $target->execute(["id" => $id, "company_id" => $companyId]);
    $existing = $target->fetch();
    if (!$existing) {
        json_response(
            ["error" => "Login não encontrado para esta empresa."],
            404,
        );
    }
    if ((int) $id === (int) $actor["id"] && !$active) {
        json_response(
            ["error" => "Você não pode desativar o próprio acesso."],
            409,
        );
    }
    $sql = "UPDATE usuarios SET name = :name, role = :role, active = :active";
    $params = [
        "name" => $name,
        "role" => $role,
        "active" => $active ? 1 : 0,
        "id" => $id,
    ];
    if ($password !== "") {
        $sql .= ", password_hash = :password_hash";
        $params["password_hash"] = password_hash($password, PASSWORD_DEFAULT);
    }
    $sql .= " WHERE id = :id";
    $pdo->prepare($sql)->execute($params);
    record_operational_event(
        $pdo,
        $actor,
        "USUARIO_ATUALIZADO",
        "user",
        (int) $id,
        [
            "company_id" => $companyId,
            "role" => $role,
            "active" => $active ? 1 : 0,
            "password_reset" => $password !== "",
        ],
    );
    json_response(["data" => ["id" => (int) $id, "updated" => true]]);
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    json_response(["error" => "Método não permitido."], 405);
}
require_csrf();
$payload = request_json();
$companyId = $resolveCompanyId($payload);
$name = trim((string) ($payload["name"] ?? ""));
$emailPrefix = strtolower(trim((string) ($payload["email_prefix"] ?? "")));
$emailDomain = strtolower(
    trim((string) (getenv("LOGIN_EMAIL_DOMAIN") ?: "dallogix.local")),
);
$email = $emailPrefix . "@" . $emailDomain;
$password = (string) ($payload["password"] ?? "");
$role = strtoupper(trim((string) ($payload["role"] ?? "")));
$allowedRoles = $isPlatformAdmin
    ? ["ADMIN_EMPRESA", "SUPERVISOR", "USUARIO"]
    : ["SUPERVISOR", "USUARIO"];
if (
    $name === "" ||
    mb_strlen($name) > 160 ||
    !preg_match('/^[a-z0-9][a-z0-9._-]{2,63}$/', $emailPrefix) ||
    !filter_var($email, FILTER_VALIDATE_EMAIL) ||
    strlen($password) < 10 ||
    !in_array($role, $allowedRoles, true)
) {
    json_response(
        [
            "error" =>
            "Informe nome, início do e-mail com 3 a 64 caracteres, senha de no mínimo 10 caracteres e um perfil permitido.",
        ],
        422,
    );
}
$exists = $pdo->prepare("SELECT id FROM empresas WHERE id = :id");
$exists->execute(["id" => $companyId]);
if (!$exists->fetch()) {
    json_response(["error" => "Empresa não encontrada."], 404);
}
try {
    $insert = $pdo->prepare(
        "INSERT INTO usuarios (company_id, name, email, password_hash, role) VALUES (:company_id, :name, :email, :password_hash, :role)",
    );
    $insert->execute([
        "company_id" => $companyId,
        "name" => $name,
        "email" => $email,
        "password_hash" => password_hash($password, PASSWORD_DEFAULT),
        "role" => $role,
    ]);
    $id = (int) $pdo->lastInsertId();
    record_operational_event($pdo, $actor, "USUARIO_CRIADO", "user", $id, [
        "company_id" => $companyId,
        "role" => $role,
    ]);
    json_response(
        [
            "data" => [
                "id" => $id,
                "name" => $name,
                "email" => $email,
                "role" => $role,
            ],
        ],
        201,
    );
} catch (PDOException $exception) {
    json_response(["error" => "Já existe um login com este e-mail."], 409);
}
