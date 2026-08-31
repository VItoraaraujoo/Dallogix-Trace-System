<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

if ($_SERVER["REQUEST_METHOD"] !== "GET") {
    json_response(["error" => "Método não permitido."], 405);
}
require_internal_token("PLC_INTERNAL_TOKEN", "change-me-plc-token");

$statement = db()->query(
    "SELECT id, equipment_code, name, plc_ip, plc_port, plc_protocol FROM equipments ORDER BY id",
);
json_response(["data" => $statement->fetchAll()]);
