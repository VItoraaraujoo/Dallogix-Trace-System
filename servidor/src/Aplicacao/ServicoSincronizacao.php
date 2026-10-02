<?php

declare(strict_types=1);

namespace App\Aplicacao;

use PDO;
use RuntimeException;

final class ServicoSincronizacao
{
    private const RESERVA_EXPIRADA_APOS_MINUTOS = 5;
    private const TEMPO_LIMITE_CONEXAO_SEGUNDOS = 3;
    private const TEMPO_LIMITE_REQUISICAO_SEGUNDOS = 10;
    public function __construct(private readonly PDO $connection)
    {
    }

    /** @return array{processed:bool,status:string,id:int,reason?:string,error?:string,http_code?:int} */
    public function processarUm(int $queueId, int $companyId): array
    {
        // Recupera reservas vencidas antes de consultar o evento; isso evita que
        // um retry individual fique preso em PROCESSANDO para sempre.
        $this->recuperarReservasVencidas();
        $event = $this->localizarEvento($queueId, $companyId);
        if ($event === null) {
            return [
                "processed" => false,
                "status" => "NAO_ENCONTRADO",
                "id" => $queueId,
                "reason" => "Evento não encontrado ou não disponível para retry.",
            ];
        }

        $batchUrl = $this->obterUrlRemotaEmLote();
        $remoteUrl = $batchUrl !== "" ? $batchUrl : $this->obterUrlRemota($companyId);
        if ($remoteUrl === "") {
            return [
                "processed" => false,
                "status" => (string) $event["status"],
                "id" => $queueId,
                "reason" => "Nenhum endpoint de sincronização remota configurado",
            ];
        }

        $reserved = $this->reservarLote(1, $companyId, $queueId);
        if ($reserved === []) {
            return [
                "processed" => false,
                "status" => "CONCORRENTE",
                "id" => $queueId,
                "reason" => "Evento já reservado ou aguardando o próximo horário de tentativa.",
            ];
        }

        return $batchUrl !== ""
            ? $this->entregarLote($reserved, $remoteUrl)
            : $this->entregarEvento($reserved[0], $remoteUrl);
    }

    /** @return array{reserved:int,sent:int,failed:int,skipped:int} */
    public function processarLote(int $limit = 50): array
    {
        $limit = max(1, min(500, $limit));
        // A descoberta por empresa acontece antes de reserveBatch(), portanto a
        // recuperação precisa ocorrer aqui também para incluir filas expiradas.
        $this->recuperarReservasVencidas();
        $installedCompanyId = $this->obterIdEmpresaInstalada();
        $installedRemoteUrl = $installedCompanyId !== null
            ? $this->obterUrlRemota($installedCompanyId)
            : "";
        $usesInstalledSync = $installedCompanyId !== null && $installedRemoteUrl !== "";
        $batchUrl = $usesInstalledSync ? "" : $this->obterUrlRemotaEmLote();
        $globalRemoteUrl = $usesInstalledSync ? "" : $this->obterUrlRemota();
        $companyIds = $batchUrl !== "" || $globalRemoteUrl !== ""
            ? [null]
            : $this->empresasComUrlRemota();
        if ($usesInstalledSync) {
            $companyIds = [$installedCompanyId];
        }
        $summary = ["reserved" => 0, "sent" => 0, "failed" => 0, "skipped" => 0];

        foreach ($companyIds as $companyId) {
            $remoteUrl = $batchUrl !== ""
                ? $batchUrl
                : ($globalRemoteUrl !== ""
                ? $globalRemoteUrl
                : $this->obterUrlRemota($companyId));
            if ($remoteUrl === "") {
                continue;
            }
            $events = $this->reservarLote($limit, $companyId);
            $summary["reserved"] += count($events);
            if ($events === []) {
                continue;
            }
            if ($batchUrl !== "") {
                $result = $this->entregarLote($events, $remoteUrl);
                $summary["sent"] += (int) ($result["sent"] ?? 0);
                $summary["failed"] += (int) ($result["failed"] ?? 0);
                continue;
            }
            foreach ($events as $event) {
                $result = $this->entregarEvento($event, $remoteUrl);
                if ($result["processed"] === true && $result["status"] === "ENVIADO") {
                    $summary["sent"]++;
                } elseif ($result["status"] === "ERRO") {
                    $summary["failed"]++;
                } else {
                    $summary["skipped"]++;
                }
            }
        }

        return $summary;
    }

    /** @return list<array<string,mixed>> */
    public function reservarLote(int $limit = 50, ?int $companyId = null, ?int $queueId = null): array
    {
        $limit = max(1, min(500, $limit));
        $this->recuperarReservasVencidas();
        $this->connection->beginTransaction();
        try {
            $where = [
                "q.status IN ('PENDENTE', 'ERRO')",
                "(q.available_at IS NULL OR q.available_at <= NOW())",
                // Um evento posterior do mesmo agregado só pode avançar
                // depois que o anterior foi confirmado ou movido para a fila
                // morta. Assim o backoff não reordena o estado remoto.
                "NOT EXISTS (
                    SELECT 1 FROM fila_sincronizacao anterior
                    WHERE anterior.company_id = q.company_id
                      AND anterior.aggregate_type = q.aggregate_type
                      AND anterior.aggregate_id = q.aggregate_id
                      AND anterior.id < q.id
                      AND anterior.status IN ('PENDENTE', 'PROCESSANDO', 'ERRO')
                )",
            ];
            $params = [];
            if ($companyId !== null) {
                $where[] = "q.company_id = :company_id";
                $params["company_id"] = $companyId;
            }
            if ($queueId !== null) {
                $where[] = "q.id = :queue_id";
                $params["queue_id"] = $queueId;
            }

            $statement = $this->connection->prepare(
                "SELECT q.id, q.company_id, e.remote_company_id, q.event_uuid, q.aggregate_type, q.aggregate_id, q.payload,
                        q.status, q.attempts, q.transient_attempts, q.last_error, q.available_at, q.created_at
                 FROM fila_sincronizacao q
                 LEFT JOIN empresas e ON e.id = q.company_id
                 WHERE " . implode(" AND ", $where) .
                    " ORDER BY q.id ASC LIMIT {$limit} FOR UPDATE SKIP LOCKED",
            );
            $statement->execute($params);
            $events = $statement->fetchAll();
            if ($events === []) {
                $this->connection->commit();
                return [];
            }

            $update = $this->connection->prepare(
                "UPDATE fila_sincronizacao
                 SET status = 'PROCESSANDO', processing_started_at = NOW(3), last_error = NULL
                 WHERE id = :id AND status IN ('PENDENTE', 'ERRO')",
            );
            foreach ($events as $event) {
                $update->execute(["id" => $event["id"]]);
                if ($update->rowCount() !== 1) {
                    throw new RuntimeException("Não foi possível reservar evento de sincronização.");
                }
                $event["status"] = "PROCESSANDO";
                $event["attempts"] = (int) $event["attempts"];
            }
            $this->connection->commit();
            return $events;
        } catch (\Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $exception;
        }
    }

    /** @return array{processed:bool,status:string,id:int,sent?:int,failed?:int,error?:string,http_code?:int} */
    private function entregarEvento(array $event, string $remoteUrl): array
    {
        try {
            $result = $this->enviarEventoRemoto($event, $remoteUrl);
        } catch (\Throwable $exception) {
            $result = [
                "ok" => false,
                "error" => "Payload de sincronização inválido: " . $exception->getMessage(),
                "http_code" => 0,
            ];
        }
        $id = (int) $event["id"];
        if ($result["ok"] === true) {
            try {
                $this->aplicarMapeamentosRemotos([$event], (array) ($result["response"] ?? []));
                $this->marcarComoEnviados([$event]);
                return ["processed" => true, "status" => "ENVIADO", "id" => $id];
            } catch (\Throwable $exception) {
                $this->marcarComoFalha(
                    [$event],
                    "Mapeamento remoto inválido: " . $exception->getMessage(),
                    0,
                    true,
                );
                return [
                    "processed" => false,
                    "status" => "ERRO",
                    "id" => $id,
                    "error" => "Mapeamento remoto inválido: " . $exception->getMessage(),
                    "http_code" => (int) ($result["http_code"] ?? 0),
                ];
            }
        }

        $error = $result["error"];
        $this->marcarComoFalha([$event], $error, (int) ($result["http_code"] ?? 0));
        return [
            "processed" => false,
            "status" => "ERRO",
            "id" => $id,
            "error" => $error,
            "http_code" => $result["http_code"],
        ];
    }

    /** @return array{processed:bool,status:string,id:int,sent:int,failed:int,error?:string,http_code?:int} */
    private function entregarLote(array $events, string $remoteUrl): array
    {
        $firstId = (int) ($events[0]["id"] ?? 0);
        try {
            $result = $this->enviarLote($events, $remoteUrl);
        } catch (\Throwable $exception) {
            $result = [
                "ok" => false,
                "error" => "Payload de sincronização inválido: " . $exception->getMessage(),
                "http_code" => 0,
            ];
        }
        if ($result["ok"] === true) {
            try {
                $this->aplicarMapeamentosRemotos($events, (array) ($result["response"] ?? []));
                $this->marcarComoEnviados($events);
                return [
                    "processed" => true,
                    "status" => "ENVIADO",
                    "id" => $firstId,
                    "sent" => count($events),
                    "failed" => 0,
                ];
            } catch (\Throwable $exception) {
                $error = "Mapeamento remoto inválido: " . $exception->getMessage();
                if (count($events) > 1) {
                    return $this->entregarLotePorEvento($events, $remoteUrl, $error, true);
                }
                $this->marcarComoFalha($events, $error, 0, true);
                return [
                    "processed" => false,
                    "status" => "ERRO",
                    "id" => $firstId,
                    "sent" => 0,
                    "failed" => count($events),
                    "error" => $error,
                    "http_code" => (int) ($result["http_code"] ?? 0),
                ];
            }
        }

        $httpCode = (int) ($result["http_code"] ?? 0);
        // Respostas 4xx normalmente apontam para um único payload inválido.
        // Tente os eventos separadamente para que os válidos avancem. Falhas
        // de rede, 5xx e 429 continuam usando uma única reserva do lote.
        if ($httpCode >= 400 && $httpCode < 500 && !in_array($httpCode, [408, 429], true) && count($events) > 1) {
            return $this->entregarLotePorEvento($events, $remoteUrl, $result["error"], false);
        }
        $this->marcarComoFalha($events, $result["error"], $httpCode);
        return [
            "processed" => false,
            "status" => "ERRO",
            "id" => $firstId,
            "sent" => 0,
            "failed" => count($events),
            "error" => $result["error"],
            "http_code" => $httpCode,
        ];
    }

    /** @param list<array<string,mixed>> $events */
    private function entregarLotePorEvento(
        array $events,
        string $remoteUrl,
        string $fallbackError,
        bool $mappingFailure,
    ): array {
        $sent = 0;
        $failed = 0;
        $firstId = (int) ($events[0]["id"] ?? 0);
        foreach ($events as $event) {
            if ($mappingFailure) {
                $this->marcarComoFalha([$event], $fallbackError, 0, true);
                $failed++;
                continue;
            }
            $result = $this->entregarEvento($event, $remoteUrl);
            if (($result["status"] ?? "") === "ENVIADO") {
                $sent++;
            } else {
                $failed++;
            }
        }
        return [
            "processed" => $failed === 0,
            "status" => $failed === 0 ? "ENVIADO" : "ERRO",
            "id" => $firstId,
            "sent" => $sent,
            "failed" => $failed,
            "error" => $failed > 0 ? $fallbackError : null,
        ];
    }

    /** @return array{ok:bool,error:string,http_code:int,response?:array<string,mixed>} */
    private function enviarEventoRemoto(array $event, string $remoteUrl): array
    {
        $body = json_encode([
            "event_uuid" => $event["event_uuid"],
            "company_id" => $this->idEmpresaRemota($event),
            "aggregate_type" => $event["aggregate_type"],
            "aggregate_id" => (int) $event["aggregate_id"],
            "payload" => $this->decodificarCarga($event),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        return $this->postarJson($remoteUrl, $body, (int) $event["company_id"]);
    }

    /** @return array{ok:bool,error:string,http_code:int,response?:array<string,mixed>} */
    private function enviarLote(array $events, string $remoteUrl): array
    {
        $items = [];
        foreach ($events as $event) {
            $items[] = [
                "event_uuid" => $event["event_uuid"],
                "company_id" => $this->idEmpresaRemota($event),
                "aggregate_type" => $event["aggregate_type"],
                "aggregate_id" => (int) $event["aggregate_id"],
                "payload" => $this->decodificarCarga($event),
            ];
        }
        $body = json_encode(["events" => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $companyId = (int) ($events[0]["company_id"] ?? 0);
        return $this->postarJson($remoteUrl, $body, $companyId > 0 ? $companyId : null);
    }

    private function idEmpresaRemota(array $event): int
    {
        $remoteCompanyId = filter_var($event["remote_company_id"] ?? null, FILTER_VALIDATE_INT);
        return $remoteCompanyId !== false && (int) $remoteCompanyId > 0
            ? (int) $remoteCompanyId
            : (int) $event["company_id"];
    }

    /** @return array{ok:bool,error:string,http_code:int,response?:array<string,mixed>} */
    private function postarJson(string $remoteUrl, string $body, ?int $companyId = null): array
    {
        $headers = ["Accept: application/json", "Content-Type: application/json"];
        $token = $this->obterTokenRemoto($companyId);
        if ($token !== "") {
            if (preg_match('/[\r\n]/', $token) === 1) {
                return ["ok" => false, "error" => "Token de sincronização inválido.", "http_code" => 0];
            }
            $headers[] = "Authorization: Bearer " . $token;
        }
        $handle = \curl_init_url_remota_segura($remoteUrl);
        if ($handle === false) {
            return ["ok" => false, "error" => "Não foi possível inicializar o cliente HTTP.", "http_code" => 0];
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => self::TEMPO_LIMITE_CONEXAO_SEGUNDOS,
            CURLOPT_TIMEOUT => self::TEMPO_LIMITE_REQUISICAO_SEGUNDOS,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $raw = curl_exec($handle);
        $curlError = trim((string) curl_error($handle));
        $httpCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);

        if ($curlError !== "") {
            return ["ok" => false, "error" => "Falha de rede: " . $curlError, "http_code" => $httpCode];
        }
        $response = json_decode((string) $raw, true);
        if ($httpCode < 200 || $httpCode >= 300) {
            $remoteError = is_array($response) ? trim((string) ($response["error"] ?? "")) : "";
            return [
                "ok" => false,
                "error" => $remoteError !== ""
                    ? "Endpoint remoto respondeu HTTP {$httpCode}: {$remoteError}"
                    : "Endpoint remoto respondeu HTTP {$httpCode}.",
                "http_code" => $httpCode,
            ];
        }
        if (!is_array($response) || !isset($response["data"]) || !is_array($response["data"])) {
            return [
                "ok" => false,
                "error" => "Endpoint remoto retornou uma resposta inválida.",
                "http_code" => $httpCode,
            ];
        }
        return [
            "ok" => true,
            "error" => "",
            "http_code" => $httpCode,
            "response" => $response,
        ];
    }

    /** @return mixed */
    private function decodificarCarga(array $event): mixed
    {
        $payload = json_decode((string) $event["payload"], true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($payload)) {
            return $payload;
        }

        $action = trim((string) ($payload["action"] ?? ""));
        $data = is_array($payload["data"] ?? null) ? $payload["data"] : [];
        $companyId = (int) ($event["company_id"] ?? 0);
        $entityId = (int) ($event["aggregate_id"] ?? 0);
        if ($companyId <= 0 || $entityId <= 0) {
            return $payload;
        }

        if (in_array($action, ["DALA_CADASTRADA", "DALA_ATUALIZADA"], true)) {
            // Eventos antigos de Dala podem ter sido gravados antes do contrato
            // completo. Enriquece o retry usando o registro atual.
            $equipment = $this->connection->prepare(
                "SELECT equipment_code, name, plc_ip, plc_port, external_port, plc_protocol
                 FROM equipamentos WHERE id = :id AND company_id = :company_id LIMIT 1",
            );
            $equipment->execute(["id" => $entityId, "company_id" => $companyId]);
            $row = $equipment->fetch();
            if (!$row) {
                return $payload;
            }
            $payload["data"] = array_merge($data, [
                "remote_equipment_id" => $entityId,
                "equipment_code" => $row["equipment_code"],
                "name" => $row["name"],
                "plc_ip" => $row["plc_ip"],
                "plc_port" => (int) $row["plc_port"],
                "external_port" => $row["external_port"] === null ? null : (int) $row["external_port"],
                "plc_protocol" => $row["plc_protocol"],
            ]);
            return $payload;
        }

        if (in_array($action, ["PRODUTO_CADASTRADO", "PRODUTO_ATUALIZADO"], true)) {
            $product = $this->connection->prepare(
                "SELECT p.code, p.name, p.category, p.active,
                        COALESCE((SELECT cp.barcode FROM codigos_produtos cp
                                  WHERE cp.product_id = p.id ORDER BY cp.id LIMIT 1), '') AS barcode
                 FROM produtos p WHERE p.id = :id AND p.company_id = :company_id LIMIT 1",
            );
            $product->execute(["id" => $entityId, "company_id" => $companyId]);
            $row = $product->fetch();
            if ($row) {
                $payload["data"] = array_merge($data, [
                    "remote_product_id" => $entityId,
                    "code" => $row["code"],
                    "name" => $row["name"],
                    "category" => $row["category"],
                    "active" => (int) $row["active"],
                    "barcode" => $row["barcode"],
                ]);
            }
            return $payload;
        }

        if (in_array($action, ["ROMANEIO_CRIADO", "ROMANEIO_ATUALIZADO", "ROMANEIO_CANCELADO"], true)) {
            $manifest = $this->dadosSincronizacaoRomaneio($companyId, $entityId);
            if ($manifest !== null) {
                $payload["data"] = array_merge($data, $manifest);
            }
            return $payload;
        }

        if (in_array($action, [
            "CARREGAMENTO_PREPARADO",
            "CARREGAMENTO_DALA_VINCULADO",
            "CARREGAMENTO_DALA_DESVINCULADO",
            "ESTADO_CARREGAMENTO_ALTERADO",
            "CARREGAMENTO_FINALIZADO",
        ], true)) {
            $loading = $this->dadosSincronizacaoCarregamento($companyId, $entityId);
            if ($loading !== null) {
                $payload["data"] = array_merge($data, $loading);
            }
        }
        return $payload;
    }

    /** @return array<string,mixed>|null */
    private function dadosSincronizacaoRomaneio(int $companyId, int $manifestId): ?array
    {
        $statement = $this->connection->prepare(
            "SELECT r.id, r.remote_romaneio_id, r.number, r.scheduled_date, r.status, r.expedidor,
                    t.id AS truck_id, t.remote_truck_id, t.plate, t.driver_name
             FROM romaneios r
             LEFT JOIN romaneio_caminhoes t ON t.romaneio_id = r.id
             WHERE r.id = :id AND r.company_id = :company_id
             ORDER BY t.id LIMIT 1",
        );
        $statement->execute(["id" => $manifestId, "company_id" => $companyId]);
        $manifest = $statement->fetch();
        if (!$manifest) {
            return null;
        }

        $items = $this->connection->prepare(
            "SELECT ri.product_id, ri.planned_quantity, p.code, p.name, p.category,
                    COALESCE((SELECT cp.barcode FROM codigos_produtos cp
                              WHERE cp.product_id = p.id ORDER BY cp.id LIMIT 1), '') AS barcode
             FROM romaneio_itens ri JOIN produtos p ON p.id = ri.product_id
             WHERE ri.romaneio_id = :romaneio_id ORDER BY ri.id",
        );
        $items->execute(["romaneio_id" => $manifestId]);
        $normalizedItems = [];
        foreach ($items->fetchAll() as $item) {
            $normalizedItems[] = [
                "remote_product_id" => (int) $item["product_id"],
                "code" => $item["code"],
                "name" => $item["name"],
                "category" => $item["category"],
                "barcode" => $item["barcode"],
                "planned_quantity" => (int) $item["planned_quantity"],
            ];
        }

        $truck = $manifest["truck_id"] === null ? null : [
            "source_truck_id" => (int) $manifest["truck_id"],
            "remote_truck_id" => $manifest["remote_truck_id"] === null
                ? null : (int) $manifest["remote_truck_id"],
            "plate" => $manifest["plate"],
            "driver_name" => $manifest["driver_name"],
        ];
        return [
            "source_romaneio_id" => (int) $manifest["id"],
            "remote_romaneio_id" => $manifest["remote_romaneio_id"] === null
                ? null : (int) $manifest["remote_romaneio_id"],
            "number" => $manifest["number"],
            "scheduled_date" => $manifest["scheduled_date"],
            "status" => $manifest["status"],
            "expedidor" => $manifest["expedidor"],
            "truck" => $truck,
            "items" => $normalizedItems,
        ];
    }

    /** @return array<string,mixed>|null */
    private function dadosSincronizacaoCarregamento(int $companyId, int $loadingId): ?array
    {
        $statement = $this->connection->prepare(
            "SELECT c.id, c.remote_carregamento_id, c.state, c.equipment_id, c.started_at,
                    c.romaneio_id, c.truck_id, e.remote_equipment_id, e.equipment_code,
                    r.remote_romaneio_id, r.number, r.scheduled_date, r.status AS romaneio_status, r.expedidor,
                    t.remote_truck_id, t.plate, t.driver_name
             FROM carregamentos c
             JOIN romaneios r ON r.id = c.romaneio_id
             JOIN romaneio_caminhoes t ON t.id = c.truck_id
             LEFT JOIN equipamentos e ON e.id = c.equipment_id
             WHERE c.id = :id AND c.company_id = :company_id LIMIT 1",
        );
        $statement->execute(["id" => $loadingId, "company_id" => $companyId]);
        $loading = $statement->fetch();
        if (!$loading) {
            return null;
        }
        return [
            "source_carregamento_id" => (int) $loading["id"],
            "remote_carregamento_id" => $loading["remote_carregamento_id"] === null
                ? null : (int) $loading["remote_carregamento_id"],
            "carregamento_id" => (int) $loading["id"],
            "romaneio_id" => (int) $loading["romaneio_id"],
            "truck_id" => (int) $loading["truck_id"],
            "equipment_id" => $loading["equipment_id"] === null ? null : (int) $loading["equipment_id"],
            "started_at" => $loading["started_at"] ?? null,
            "source_romaneio_id" => (int) $loading["romaneio_id"],
            "remote_romaneio_id" => $loading["remote_romaneio_id"] === null
                ? null : (int) $loading["remote_romaneio_id"],
            "source_truck_id" => (int) $loading["truck_id"],
            "remote_truck_id" => $loading["remote_truck_id"] === null
                ? null : (int) $loading["remote_truck_id"],
            "remote_equipment_id" => $loading["equipment_id"] === null
                ? null : ($loading["remote_equipment_id"] === null
                    ? (int) $loading["equipment_id"] : (int) $loading["remote_equipment_id"]),
            "equipment_code" => $loading["equipment_code"],
            "state" => $loading["state"],
            "romaneio" => [
                "source_romaneio_id" => (int) $loading["romaneio_id"],
                "remote_romaneio_id" => $loading["remote_romaneio_id"] === null
                    ? null : (int) $loading["remote_romaneio_id"],
                "number" => $loading["number"],
                "scheduled_date" => $loading["scheduled_date"],
                "status" => $loading["romaneio_status"],
                "expedidor" => $loading["expedidor"],
            ],
            "romaneio_status" => $loading["romaneio_status"],
            "truck" => [
                "source_truck_id" => (int) $loading["truck_id"],
                "remote_truck_id" => $loading["remote_truck_id"] === null
                    ? null : (int) $loading["remote_truck_id"],
                "plate" => $loading["plate"],
                "driver_name" => $loading["driver_name"],
            ],
        ];
    }

    /** @param list<array<string,mixed>> $events @param array<string,mixed> $response */
    private function aplicarMapeamentosRemotos(array $events, array $response): void
    {
        $mappings = $response["data"]["mappings"] ?? [];
        if (!is_array($mappings) || $mappings === []) {
            return;
        }
        $eventsByUuid = [];
        foreach ($events as $event) {
            $eventUuid = trim((string) ($event["event_uuid"] ?? ""));
            $eventCompanyId = (int) ($event["company_id"] ?? 0);
            if ($eventUuid !== "" && $eventCompanyId > 0) {
                $eventsByUuid[$eventUuid] = $eventCompanyId;
            }
        }
        $this->connection->beginTransaction();
        try {
            foreach ($mappings as $mapping) {
                if (!is_array($mapping)) {
                    throw new RuntimeException("Mapeamento remoto inválido.");
                }
                $eventUuid = trim((string) ($mapping["event_uuid"] ?? ""));
                if ($eventUuid === "" || !isset($eventsByUuid[$eventUuid])) {
                    throw new RuntimeException("Mapeamento remoto não corresponde ao lote enviado.");
                }
                $local = is_array($mapping["local"] ?? null) ? $mapping["local"] : [];
                $remote = is_array($mapping["remote"] ?? null) ? $mapping["remote"] : [];
                $companyId = $eventsByUuid[$eventUuid];
                $localEquipmentId = (int) ($local["equipment_id"] ?? 0);
                $remoteEquipmentId = (int) ($remote["equipment_id"] ?? 0);
                if ($localEquipmentId > 0 && $remoteEquipmentId > 0) {
                    $this->connection->prepare(
                        "UPDATE equipamentos SET remote_equipment_id = :remote_id
                         WHERE id = :id AND company_id = :company_id",
                    )->execute([
                        "remote_id" => $remoteEquipmentId,
                        "id" => $localEquipmentId,
                        "company_id" => $companyId,
                    ]);
                }
                $localManifestId = (int) ($local["romaneio_id"] ?? 0);
                $remoteManifestId = (int) ($remote["romaneio_id"] ?? 0);
                if ($localManifestId > 0 && $remoteManifestId > 0) {
                    $this->connection->prepare(
                        "UPDATE romaneios SET remote_romaneio_id = :remote_id
                         WHERE id = :id AND company_id = :company_id",
                    )->execute([
                        "remote_id" => $remoteManifestId,
                        "id" => $localManifestId,
                        "company_id" => $companyId,
                    ]);
                }
                $localTruckId = (int) ($local["truck_id"] ?? 0);
                $remoteTruckId = (int) ($remote["truck_id"] ?? 0);
                if ($localTruckId > 0 && $remoteTruckId > 0) {
                    $this->connection->prepare(
                        "UPDATE romaneio_caminhoes t SET remote_truck_id = :remote_id
                         WHERE t.id = :id AND t.romaneio_id = :romaneio_id
                           AND EXISTS (SELECT 1 FROM romaneios r
                                       WHERE r.id = t.romaneio_id AND r.company_id = :company_id)",
                    )->execute([
                        "remote_id" => $remoteTruckId,
                        "id" => $localTruckId,
                        "romaneio_id" => $localManifestId,
                        "company_id" => $companyId,
                    ]);
                }
                $localLoadingId = (int) ($local["carregamento_id"] ?? 0);
                $remoteLoadingId = (int) ($remote["carregamento_id"] ?? 0);
                if ($localLoadingId > 0 && $remoteLoadingId > 0) {
                    $this->connection->prepare(
                        "UPDATE carregamentos SET remote_carregamento_id = :remote_id
                         WHERE id = :id AND company_id = :company_id",
                    )->execute([
                        "remote_id" => $remoteLoadingId,
                        "id" => $localLoadingId,
                        "company_id" => $companyId,
                    ]);
                }
            }
            $this->connection->commit();
        } catch (\Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $exception;
        }
    }

    /** @param list<array<string,mixed>> $events */
    private function marcarComoEnviados(array $events): void
    {
        $this->connection->beginTransaction();
        try {
            $queue = $this->connection->prepare(
                "UPDATE fila_sincronizacao
                 SET status = 'ENVIADO', last_error = NULL, processing_started_at = NULL
                 WHERE id = :id AND company_id = :company_id AND status = 'PROCESSANDO'",
            );
            $audit = $this->connection->prepare(
                "UPDATE logs_auditoria
                 SET delivered_at = COALESCE(delivered_at, NOW(3))
                 WHERE company_id = :company_id AND event_uuid = :event_uuid",
            );
            foreach ($events as $event) {
                $queue->execute([
                    "id" => (int) $event["id"],
                    "company_id" => (int) $event["company_id"],
                ]);
                if ($queue->rowCount() !== 1) {
                    throw new RuntimeException("Evento de sincronização não está mais reservado.");
                }
                $audit->execute([
                    "company_id" => (int) $event["company_id"],
                    "event_uuid" => $event["event_uuid"],
                ]);
            }
            $this->connection->commit();
        } catch (\Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $exception;
        }
    }

    /** @param list<array<string,mixed>> $events */
    private function marcarComoFalha(
        array $events,
        string $error,
        int $httpCode = 0,
        bool $permanentOverride = false,
    ): void
    {
        $maxAttempts = max(1, min(100, (int) (getenv("SYNC_MAX_ATTEMPTS") ?: 5)));
        $permanent = $permanentOverride || (
            $httpCode >= 400 &&
            $httpCode < 500 &&
            !in_array($httpCode, [408, 429], true)
        );
        $incrementPermanentAttempts = $permanent ? 1 : 0;
        $this->connection->beginTransaction();
        try {
            $failed = $this->connection->prepare(
                "UPDATE fila_sincronizacao
                 SET status = 'ERRO', attempts = attempts + :increment_attempts,
                     transient_attempts = transient_attempts + 1,
                     last_error = :last_error,
                     available_at = DATE_ADD(NOW(), INTERVAL LEAST(POWER(2, LEAST(transient_attempts, 8)) * 5, 900) SECOND),
                     processing_started_at = NULL
                 WHERE id = :id AND company_id = :company_id AND status = 'PROCESSANDO'",
            );
            foreach ($events as $event) {
                $failed->execute([
                    "id" => (int) $event["id"],
                    "company_id" => (int) $event["company_id"],
                    "last_error" => $error,
                    "increment_attempts" => $incrementPermanentAttempts,
                ]);
                if ($failed->rowCount() !== 1) {
                    throw new RuntimeException("Evento de sincronização não está mais reservado para falha.");
                }
                $nextPermanentAttempts = (int) ($event["attempts"] ?? 0) + $incrementPermanentAttempts;
                if ($permanent && $nextPermanentAttempts >= $maxAttempts) {
                    $this->moverParaFilaMorta($event, $error);
                }
            }
            $this->connection->commit();
        } catch (\Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $exception;
        }
    }

    /** @param array<string,mixed> $event */
    private function moverParaFilaMorta(array $event, string $error): void
    {
        $insert = $this->connection->prepare(
            "INSERT INTO sync_dead_letter_queue
                (original_event_id, company_id, event_uuid, event_type, aggregate_id, payload, last_error, failed_attempts)
             SELECT id, company_id, event_uuid, aggregate_type, aggregate_id, payload, :last_error, attempts
             FROM fila_sincronizacao
             WHERE id = :id AND company_id = :company_id AND status = 'ERRO'
             ON DUPLICATE KEY UPDATE
                last_error = VALUES(last_error), failed_attempts = VALUES(failed_attempts),
                resolved_at = NULL, resolved_by = NULL, resolution_note = NULL",
        );
        $insert->execute([
            "id" => (int) $event["id"],
            "company_id" => (int) $event["company_id"],
            "last_error" => $error,
        ]);

        if ($insert->rowCount() < 1) {
            throw new RuntimeException("Não foi possível arquivar o evento na fila morta.");
        }

        $delete = $this->connection->prepare(
            "DELETE FROM fila_sincronizacao
             WHERE id = :id AND company_id = :company_id AND status = 'ERRO'",
        );
        $delete->execute([
            "id" => (int) $event["id"],
            "company_id" => (int) $event["company_id"],
        ]);
        if ($delete->rowCount() !== 1) {
            throw new RuntimeException("Evento não foi removido da fila após arquivamento.");
        }
    }

    private function recuperarReservasVencidas(): void
    {
        $statement = $this->connection->prepare(
            "UPDATE fila_sincronizacao
             SET status = 'ERRO',
                 last_error = 'Reserva recuperada após expirar o tempo de processamento.',
                 available_at = NOW(), processing_started_at = NULL
             WHERE status = 'PROCESSANDO'
               AND processing_started_at < DATE_SUB(NOW(), INTERVAL " . self::RESERVA_EXPIRADA_APOS_MINUTOS . " MINUTE)",
        );
        $statement->execute();
    }

    /** @return array<string,mixed>|null */
    private function localizarEvento(int $queueId, int $companyId): ?array
    {
        $statement = $this->connection->prepare(
            "SELECT * FROM fila_sincronizacao
             WHERE id = :id AND company_id = :company_id
               AND status IN ('PENDENTE', 'ERRO')
             LIMIT 1",
        );
        $statement->execute(["id" => $queueId, "company_id" => $companyId]);
        $event = $statement->fetch();
        return $event ?: null;
    }

    /** @return list<int> */
    private function empresasComUrlRemota(): array
    {
        $statement = $this->connection->query(
            "SELECT DISTINCT q.company_id
             FROM fila_sincronizacao q
             JOIN configuracoes_empresa c ON c.company_id = q.company_id
             WHERE q.status IN ('PENDENTE', 'ERRO')
               AND (q.available_at IS NULL OR q.available_at <= NOW())
               AND c.sync_remote_url IS NOT NULL AND TRIM(c.sync_remote_url) <> ''
             ORDER BY q.company_id",
        );
        return array_map(static fn (array $row): int => (int) $row["company_id"], $statement->fetchAll());
    }

    private function obterUrlRemota(?int $companyId = null): string
    {
        if ($companyId !== null) {
            $statement = $this->connection->prepare(
                "SELECT sync_remote_url FROM configuracoes_empresa WHERE company_id = :company_id LIMIT 1",
            );
            $statement->execute(["company_id" => $companyId]);
            $configured = trim((string) ($statement->fetchColumn() ?: ""));
            if ($configured !== "") {
                return \url_remota_segura($configured);
            }
        }
        return \url_remota_segura(trim((string) (getenv("SYNC_REMOTE_URL") ?: "")));
    }

    private function obterTokenRemoto(?int $companyId = null): string
    {
        $installation = $this->connection->query(
            "SELECT company_id, sync_token
             FROM instalacoes_locais WHERE id = 1 LIMIT 1",
        )->fetch();
        if ($installation) {
            $installedCompanyId = (int) ($installation["company_id"] ?? 0);
            if ($companyId === null || $installedCompanyId === $companyId) {
                $normalized = strtolower(trim((string) ($installation["sync_token"] ?? "")));
                return preg_match('/\A[a-f0-9]{64}\z/', $normalized) === 1 ? $normalized : "";
            }
            // Nunca use um token global para enviar eventos de outra empresa
            // quando esta instalação já está vinculada a uma empresa.
            return "";
        }
        return trim((string) (getenv("SYNC_REMOTE_TOKEN") ?: ""));
    }

    private function obterIdEmpresaInstalada(): ?int
    {
        $statement = $this->connection->query(
            "SELECT company_id FROM instalacoes_locais
             WHERE id = 1 AND sync_token IS NOT NULL AND TRIM(sync_token) <> '' LIMIT 1",
        );
        $companyId = $statement->fetchColumn();
        return $companyId === false ? null : (int) $companyId;
    }

    private function obterUrlRemotaEmLote(): string
    {
        return \url_remota_segura(trim((string) (getenv("SYNC_REMOTE_BATCH_URL") ?: "")));
    }
}
