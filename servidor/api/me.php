<?php

declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

$user = require_session_user();

json_response([
    "authenticated" => true,
    "user" => $user,
    "csrf_token" => csrf_token(),
]);
