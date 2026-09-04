<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$payload = request_json();
$email = strtolower(trim((string) ($payload["email"] ?? "")));
$password = (string) ($payload["password"] ?? "");

if ($email === "" || $password === "") {
    json_response(["error" => "Informe e-mail e senha."], 422);
}
enforce_login_rate_limit($email);

$statement = db()->prepare(
    "SELECT id, company_id, name, email, password_hash, role, active FROM usuarios WHERE email = :email LIMIT 1",
);
$statement->execute(["email" => $email]);
$user = $statement->fetch();

if (
    !$user ||
    !(bool) $user["active"] ||
    !password_verify($password, $user["password_hash"])
) {
    usleep(150000);
    json_response(["error" => "E-mail ou senha inválidos."], 401);
}

if (password_needs_rehash($user["password_hash"], PASSWORD_DEFAULT)) {
    $rehash = db()->prepare(
        "UPDATE usuarios SET password_hash = :password_hash WHERE id = :id",
    );
    $rehash->execute([
        "password_hash" => password_hash($password, PASSWORD_DEFAULT),
        "id" => $user["id"],
    ]);
}

session_regenerate_id(true);
$_SESSION["user"] = public_user($user);

json_response([
    "authenticated" => true,
    "user" => $_SESSION["user"],
    "csrf_token" => csrf_token(),
]);
