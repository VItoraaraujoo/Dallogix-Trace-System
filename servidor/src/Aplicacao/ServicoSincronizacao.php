<?php

declare(strict_types=1);

namespace App\Aplicacao;

use PDO;
use RuntimeException;

final class ServicoSincronizacao
{
    private const STALE_AFTER_MINUTES = 5;
    private const CONNECT_TIMEOUT_SECONDS = 3;
    private const REQUEST_TIMEOUT_SECONDS = 10;
    public function __construct(private readonly PDO $connection)
    {
    }

    /** @return array{processed:bool,status:string,id:int,reason?:string,error?:string,http_code?:int} */
    public function processOne(int $queueId, int $companyId): array
    {
        // Recupera reservas vencidas antes de consultar o evento; isso evita que
        // um retry individual fique preso em PROCESSANDO para sempre.
        $this->recoverStaleReservations();
        $event = $this->findEvent($queueId, $companyId);
        if ($event === null) {
            return [
                "processed" => false,
                "status" => "NAO_ENCONTRADO",
                "id" => $queueId,
                "reason" => "Evento não encontrado ou não disponível para retry.",
            ];
        }

        $batchUrl = $this->batchRemoteUrl();
        $remoteUrl = $batchUrl !== "" ? $batchUrl : $this->remoteUrl($companyId);
        if ($remoteUrl === "") {
            return [
                "processed" => false,
                "status" => (string) $event["status"],
                "id" => $queueId,
                "reason" => "Nenhum endpoint de sincronização remota configurado",
            ];
        }

        $reserved = $this->reserveBatch(1, $companyId, $queueId);
        if ($reserved === []) {
            return [
                "processed" => false,
                "status" => "CONCORRENTE",
                "id" => $queueId,
                "reason" => "Evento já reservado ou aguardando o próximo horário de tentativa.",
            ];
        }

        return $batchUrl !== ""
            ? $this->deliverBatch($reserved, $remoteUrl)
            : $this->deliver($reserved[0], $remoteUrl);
    }

    /** @return array{reserved:int,sent:int,failed:int,skipped:int} */
    public function processBatch(int $limit = 50): array
    {
        $limit = max(1, min(500, $limit));
        // A descoberta por empresa acontece antes de reserveBatch(), portanto a
        // recuperação precisa ocorrer aqui também para incluir filas expiradas.
        $this->recoverStaleReservations();
        $installedCompanyId = $this->installedCompanyId();
        $installedRemoteUrl = $installedCompanyId !== null
            ? $this->remoteUrl($installedCompanyId)
            : "";
        $usesInstalledSync = $installedCompanyId !== null && $installedRemoteUrl !== "";
        $batchUrl = $usesInstalledSync ? "" : $this->batchRemoteUrl();
        $globalRemoteUrl = $usesInstalledSync ? "" : $this->remoteUrl();
        $companyIds = $batchUrl !== "" || $globalRemoteUrl !== ""
            ? [null]
            : $this->companiesWithRemoteUrl();
        if ($usesInstalledSync) {
            $companyIds = [$installedCompanyId];
        }
        $summary = ["reserved" => 0, "sent" => 0, "failed" => 0, "skipped" => 0];

        foreach ($companyIds as $companyId) {
            $remoteUrl = $batchUrl !== ""
                ? $batchUrl
                : ($globalRemoteUrl !== ""
                ? $globalRemoteUrl
                : $this->remoteUrl($companyId));
            if ($remoteUrl === "") {
                continue;
            }
            $events = $this->reserveBatch($limit, $companyId);
            $summary["reserved"] += count($events);
            if ($events === []) {
                continue;
            }
            if ($batchUrl !== "") {
                $result = $this->deliverBatch($events, $remoteUrl);
                $summary["sent"] += (int) ($result["sent"] ?? 0);
                $summary["failed"] += (int) ($result["failed"] ?? 0);
                continue;
            }
            foreach ($events as $event) {
                $result = $this->deliver($event, $remoteUrl);
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
    public function reserveBatch(int $limit = 50, ?int $companyId = null, ?int $queueId = null): array
    {
        $limit = max(1, min(500, $limit));
        $this->recoverStaleReservations();
        $this->connection->beginTransaction();
        try {
            $where = [
                "q.status IN ('PENDENTE', 'ERRO')",
                "(q.available_at IS NULL OR q.available_at <= NOW())",
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
                        q.status, q.attempts, q.last_error, q.available_at, q.created_at
                 FROM fila_sincronizacao q
                 LEFT JOIN empresas e ON e.id = q.company_id
                 WHERE " . implode(" AND ", $where) .
                    " ORDER BY id ASC LIMIT {$limit} FOR UPDATE SKIP LOCKED",
            );
            $statement->execute($params);
            $events = $statement->fetchAll();
            if ($events === []) {
                $this->connection->commit();
                return [];
            }

            $update = $this->connection->prepare(
                "UPDATE fila_sincronizacao
                 SET status = 'PROCESSANDO', attempts = attempts + 1,
                     processing_started_at = NOW(3), last_error = NULL
                 WHERE id = :id AND status IN ('PENDENTE', 'ERRO')",
            );
            foreach ($events as $event) {
                $update->execute(["id" => $event["id"]]);
                if ($update->rowCount() !== 1) {
                    throw new RuntimeException("Não foi possível reservar evento de sincronização.");
                }
                $event["status"] = "PROCESSANDO";
                $event["attempts"] = (int) $event["attempts"] + 1;
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
    private function deliver(array $event, string $remoteUrl): array
    {
        try {
            $result = $this->send($event, $remoteUrl);
        } catch (\Throwable $exception) {
            $result = [
                "ok" => false,
                "error" => "Payload de sincronização inválido: " . $exception->getMessage(),
                "http_code" => 0,
            ];
        }
        $id = (int) $event["id"];
        if ($result["ok"] === true) {
            $this->markSent([$event]);
            return ["processed" => true, "status" => "ENVIADO", "id" => $id];
        }

        $error = $result["error"];
        $this->markFailed([$event], $error);
        return [
            "processed" => false,
            "status" => "ERRO",
            "id" => $id,
            "error" => $error,
            "http_code" => $result["http_code"],
        ];
    }

    /** @return array{processed:bool,status:string,id:int,sent:int,failed:int,error?:string,http_code?:int} */
    private function deliverBatch(array $events, string $remoteUrl): array
    {
        $firstId = (int) ($events[0]["id"] ?? 0);
        try {
            $result = $this->sendBatch($events, $remoteUrl);
        } catch (\Throwable $exception) {
            $result = [
                "ok" => false,
                "error" => "Payload de sincronização inválido: " . $exception->getMessage(),
                "http_code" => 0,
            ];
        }
        if ($result["ok"] === true) {
            $this->markSent($events);
            return [
                "processed" => true,
                "status" => "ENVIADO",
                "id" => $firstId,
                "sent" => count($events),
                "failed" => 0,
            ];
        }

        $this->markFailed($events, $result["error"]);
        return [
            "processed" => false,
            "status" => "ERRO",
            "id" => $firstId,
            "sent" => 0,
            "failed" => count($events),
            "error" => $result["error"],
            "http_code" => $result["http_code"],
        ];
    }

    /** @return array{ok:bool,error:string,http_code:int} */
    private function send(array $event, string $remoteUrl): array
    {
        $body = json_encode([
            "event_uuid" => $event["event_uuid"],
            "company_id" => $this->remoteCompanyId($event),
            "aggregate_type" => $event["aggregate_type"],
            "aggregate_id" => (int) $event["aggregate_id"],
            "payload" => $this->decodePayload($event),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        return $this->postJson($remoteUrl, $body, (int) $event["company_id"]);
    }

    /** @return array{ok:bool,error:string,http_code:int} */
    private function sendBatch(array $events, string $remoteUrl): array
    {
        $items = [];
        foreach ($events as $event) {
            $items[] = [
                "event_uuid" => $event["event_uuid"],
                "company_id" => $this->remoteCompanyId($event),
                "aggregate_type" => $event["aggregate_type"],
                "aggregate_id" => (int) $event["aggregate_id"],
                "payload" => $this->decodePayload($event),
            ];
        }
        $body = json_encode(["events" => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return $this->postJson($remoteUrl, $body);
    }

    private function remoteCompanyId(array $event): int
    {
        $remoteCompanyId = filter_var($event["remote_company_id"] ?? null, FILTER_VALIDATE_INT);
        return $remoteCompanyId !== false && (int) $remoteCompanyId > 0
            ? (int) $remoteCompanyId
            : (int) $event["company_id"];
    }

    /** @return array{ok:bool,error:string,http_code:int} */
    private function postJson(string $remoteUrl, string $body, ?int $companyId = null): array
    {
        $headers = ["Content-Type: application/json"];
        $token = $this->remoteToken($companyId);
        if ($token !== "") {
            if (preg_match('/[\r\n]/', $token) === 1) {
                return ["ok" => false, "error" => "Token de sincronização inválido.", "http_code" => 0];
            }
            $headers[] = "Authorization: Bearer " . $token;
        }
        $handle = curl_init($remoteUrl);
        if ($handle === false) {
            return ["ok" => false, "error" => "Não foi possível inicializar o cliente HTTP.", "http_code" => 0];
        }
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
            CURLOPT_TIMEOUT => self::REQUEST_TIMEOUT_SECONDS,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        curl_exec($handle);
        $curlError = trim((string) curl_error($handle));
        $httpCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);

        if ($curlError !== "") {
            return ["ok" => false, "error" => "Falha de rede: " . $curlError, "http_code" => $httpCode];
        }
        if ($httpCode < 200 || $httpCode >= 300) {
            return ["ok" => false, "error" => "Endpoint remoto respondeu HTTP {$httpCode}.", "http_code" => $httpCode];
        }
        return ["ok" => true, "error" => "", "http_code" => $httpCode];
    }

    /** @return mixed */
    private function decodePayload(array $event): mixed
    {
        $payload = json_decode((string) $event["payload"], true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($payload)) {
            return $payload;
        }

        $action = trim((string) ($payload["action"] ?? ""));
        if (!in_array($action, ["DALA_CADASTRADA", "DALA_ATUALIZADA"], true)) {
            return $payload;
        }

        // Eventos antigos de Dala podem ter sido gravados antes do contrato
        // completo de sincronização. Enriquece o payload na saída usando o
        // registro atual para que um retry também replique nome e comunicação.
        $equipmentId = (int) ($event["aggregate_id"] ?? 0);
        $companyId = (int) ($event["company_id"] ?? 0);
        if ($equipmentId <= 0 || $companyId <= 0) {
            return $payload;
        }
        $equipment = $this->connection->prepare(
            "SELECT equipment_code, name, plc_ip, plc_port, external_port, plc_protocol
             FROM equipamentos WHERE id = :id AND company_id = :company_id LIMIT 1",
        );
        $equipment->execute(["id" => $equipmentId, "company_id" => $companyId]);
        $row = $equipment->fetch();
        if (!$row) {
            return $payload;
        }
        $data = is_array($payload["data"] ?? null) ? $payload["data"] : [];
        $payload["data"] = array_merge($data, [
            "remote_equipment_id" => $equipmentId,
            "equipment_code" => $row["equipment_code"],
            "name" => $row["name"],
            "plc_ip" => $row["plc_ip"],
            "plc_port" => (int) $row["plc_port"],
            "external_port" => $row["external_port"] === null ? null : (int) $row["external_port"],
            "plc_protocol" => $row["plc_protocol"],
        ]);
        return $payload;
    }

    /** @param list<array<string,mixed>> $events */
    private function markSent(array $events): void
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
    private function markFailed(array $events, string $error): void
    {
        $this->connection->beginTransaction();
        try {
            $failed = $this->connection->prepare(
                "UPDATE fila_sincronizacao
                 SET status = 'ERRO', last_error = :last_error,
                     available_at = DATE_ADD(NOW(), INTERVAL LEAST(POWER(2, LEAST(attempts, 8)) * 5, 900) SECOND),
                     processing_started_at = NULL
                 WHERE id = :id AND company_id = :company_id AND status = 'PROCESSANDO'",
            );
            foreach ($events as $event) {
                $failed->execute([
                    "id" => (int) $event["id"],
                    "company_id" => (int) $event["company_id"],
                    "last_error" => $error,
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

    private function recoverStaleReservations(): void
    {
        $statement = $this->connection->prepare(
            "UPDATE fila_sincronizacao
             SET status = 'ERRO',
                 last_error = 'Reserva recuperada após expirar o tempo de processamento.',
                 available_at = NOW(), processing_started_at = NULL
             WHERE status = 'PROCESSANDO'
               AND processing_started_at < DATE_SUB(NOW(), INTERVAL " . self::STALE_AFTER_MINUTES . " MINUTE)",
        );
        $statement->execute();
    }

    /** @return array<string,mixed>|null */
    private function findEvent(int $queueId, int $companyId): ?array
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
    private function companiesWithRemoteUrl(): array
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

    private function remoteUrl(?int $companyId = null): string
    {
        if ($companyId !== null) {
            $statement = $this->connection->prepare(
                "SELECT sync_remote_url FROM configuracoes_empresa WHERE company_id = :company_id LIMIT 1",
            );
            $statement->execute(["company_id" => $companyId]);
            $configured = trim((string) ($statement->fetchColumn() ?: ""));
            if ($configured !== "") {
                return $configured;
            }
        }
        return trim((string) (getenv("SYNC_REMOTE_URL") ?: ""));
    }

    private function remoteToken(?int $companyId = null): string
    {
        if ($companyId !== null) {
            $statement = $this->connection->prepare(
                "SELECT i.sync_token
                 FROM instalacoes_locais i
                 WHERE i.id = 1 AND i.company_id = :company_id
                 LIMIT 1",
            );
            $statement->execute(["company_id" => $companyId]);
            $configured = trim((string) ($statement->fetchColumn() ?: ""));
            if ($configured !== "") {
                return $configured;
            }
        }
        return trim((string) (getenv("SYNC_REMOTE_TOKEN") ?: ""));
    }

    private function installedCompanyId(): ?int
    {
        $statement = $this->connection->query(
            "SELECT company_id FROM instalacoes_locais WHERE id = 1 AND sync_token IS NOT NULL LIMIT 1",
        );
        $companyId = $statement->fetchColumn();
        return $companyId === false ? null : (int) $companyId;
    }

    private function batchRemoteUrl(): string
    {
        return trim((string) (getenv("SYNC_REMOTE_BATCH_URL") ?: ""));
    }
}
