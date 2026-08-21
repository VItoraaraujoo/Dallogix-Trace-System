<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/bootstrap.php';

$user = session_user();
if ($user === null) {
    json_response(['authenticated' => false], 401);
}

json_response(['authenticated' => true, 'user' => $user, 'csrf_token' => csrf_token()]);
