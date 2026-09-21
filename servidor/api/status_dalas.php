<?php
declare(strict_types=1);

require_once __DIR__ . "/../configuracao/bootstrap.php";

exigir_metodo_http(["GET"]);
$usuario = exigir_sessao_usuario();
if ($usuario["company_id"] === null) {
    responder_json(["error" => "Usuário sem empresa vinculada."], 403);
}

$limiteSemSinal = limite_sinal_clp_segundos();
$consulta = obter_conexao_banco()->prepare(
    "SELECT e.id AS equipment_id,
            CASE
              WHEN d.status = 'ONLINE'
               AND d.last_seen_at >= DATE_SUB(NOW(3), INTERVAL {$limiteSemSinal} SECOND)
                THEN 'ONLINE'
              WHEN d.status = 'ERRO' THEN 'ERRO'
              ELSE 'OFFLINE'
            END AS status,
            d.last_seen_at,
            c.state AS carregamento_state,
            CASE
              WHEN d.last_seen_at IS NULL THEN NULL
              ELSE TIMESTAMPDIFF(SECOND, d.last_seen_at, NOW(3))
            END AS segundos_sem_sinal
     FROM equipamentos e
     LEFT JOIN status_dispositivos d
       ON d.equipment_id = e.id AND d.device_type = 'CLP'
     LEFT JOIN carregamentos c
       ON c.id = (SELECT c2.id FROM carregamentos c2
                  WHERE c2.equipment_id = e.id
                  ORDER BY c2.id DESC LIMIT 1)
     WHERE e.company_id = :company_id
     ORDER BY e.id",
);
$consulta->execute(["company_id" => $usuario["company_id"]]);

$statusDasDalas = array_map(
    static function (array $dala): array {
        $status = (string) $dala["status"];
        $segundos = $dala["segundos_sem_sinal"] === null
            ? null
            : max(0, (int) $dala["segundos_sem_sinal"]);
        $state = (string) ($dala["carregamento_state"] ?? "");
        if ($status !== "ONLINE") {
            $mensagem = $segundos === null
                ? "Dala sem comunicação; estado físico desconhecido."
                : "Dala sem comunicação há {$segundos} segundos; estado físico desconhecido.";
        } else {
            $mensagem = match ($state) {
                "EMERGENCIA" => "Emergência registrada; parada física aguardando confirmação do CLP.",
                "PAUSADO" => "Parada solicitada; aguardando confirmação do CLP.",
                "CARREGANDO", "FINALIZANDO" => "Operação ativa; retorno físico da esteira não informado.",
                "PREPARANDO" => "Dala em preparação.",
                default => "Dala ociosa; sem retorno de movimento configurado.",
            };
        }
        return [
            "equipment_id" => (int) $dala["equipment_id"],
            "status" => $status,
            "carregamento_state" => $state !== "" ? $state : null,
            "message" => $mensagem,
            "last_seen_at" => $dala["last_seen_at"],
            "segundos_sem_sinal" => $segundos,
        ];
    },
    $consulta->fetchAll(),
);

responder_json([
    "data" => $statusDasDalas,
    "limite_sinal_clp_segundos" => $limiteSemSinal,
]);
