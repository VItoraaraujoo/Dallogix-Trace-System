<?php

declare(strict_types=1);

namespace App\Aplicacao;

use PDO;
use RuntimeException;
use Throwable;

final class ServicoSincronizacaoRemota
{
    private const CONNECT_TIMEOUT_SECONDS = 3;
    private const REQUEST_TIMEOUT_SECONDS = 8;

    public function __construct(private readonly PDO $connection)
    {
    }

    /** @return array{enabled:bool,synced:bool,updated?:int,error?:string} */
    public function process(): array
    {
        if ((string) (getenv("TRACE_LOCAL_SIMULATION") ?: "0") === "1") {
            return ["enabled" => false, "synced" => false, "updated" => 0];
        }
        $installation = $this->installation();
        if (!$installation || trim((string) ($installation["sync_token"] ?? "")) === "") {
            return ["enabled" => false, "synced" => false, "updated" => 0];
        }

        $centralUrl = $this->centralUrl((int) $installation["company_id"]);
        if ($centralUrl === "") {
            return ["enabled" => false, "synced" => false, "updated" => 0];
        }

        try {
            $snapshot = $this->request(
                rtrim($centralUrl, "/") . "/api/sincronizacao_instalacao.php",
                (string) $installation["sync_token"],
                "GET",
            );
            $updated = $this->applySnapshot($installation, $snapshot);
            $this->sendHeartbeats($centralUrl, (string) $installation["sync_token"], (int) $installation["company_id"]);
            return ["enabled" => true, "synced" => true, "updated" => $updated];
        } catch (Throwable $exception) {
            $this->markError((string) $exception->getMessage());
            return [
                "enabled" => true,
                "synced" => false,
                "updated" => 0,
                "error" => $exception->getMessage(),
            ];
        }
    }

    /** @return array<string,mixed>|null */
    private function installation(): ?array
    {
        $statement = $this->connection->query(
            "SELECT i.company_id, i.remote_company_id, i.sync_token
             FROM instalacoes_locais i WHERE i.id = 1 LIMIT 1",
        );
        $row = $statement->fetch();
        return $row ?: null;
    }

    private function centralUrl(int $companyId): string
    {
        $configured = trim((string) (getenv("TRACE_CENTRAL_URL") ?: ""));
        if ($configured !== "") {
            return $configured;
        }
        $statement = $this->connection->prepare(
            "SELECT sync_remote_url FROM configuracoes_empresa WHERE company_id = :company_id LIMIT 1",
        );
        $statement->execute(["company_id" => $companyId]);
        $remote = trim((string) ($statement->fetchColumn() ?: ""));
        if ($remote === "") {
            $remote = trim((string) (getenv("SYNC_REMOTE_URL") ?: getenv("SYNC_REMOTE_BATCH_URL") ?: ""));
        }
        $parts = parse_url($remote);
        if (!is_array($parts) || !isset($parts["scheme"], $parts["host"])) {
            return "";
        }
        return $parts["scheme"] . "://" . $parts["host"] . (isset($parts["port"]) ? ":{$parts["port"]}" : "");
    }

    /** @return array<string,mixed> */
    private function request(string $url, string $token, string $method, ?array $payload = null): array
    {
        $handle = curl_init($url);
        if ($handle === false) {
            throw new RuntimeException("Não foi possível iniciar a sincronização remota.");
        }
        $headers = ["Accept: application/json", "Authorization: Bearer {$token}"];
        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT_SECONDS,
            CURLOPT_TIMEOUT => self::REQUEST_TIMEOUT_SECONDS,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if ($payload !== null) {
            $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
            $options[CURLOPT_HTTPHEADER][] = "Content-Type: application/json";
        }
        curl_setopt_array($handle, $options);
        $raw = curl_exec($handle);
        $curlError = trim((string) curl_error($handle));
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        if ($curlError !== "") {
            throw new RuntimeException("Falha de rede na sincronização: {$curlError}");
        }
        $decoded = json_decode((string) $raw, true);
        if (!is_array($decoded)) {
            throw new RuntimeException("Resposta inválida do servidor central.");
        }
        if ($status < 200 || $status >= 300) {
            if (($decoded["error_code"] ?? "") === "LICENSE_INACTIVE") {
                $this->syncLocalLicenseStatus(
                    (string) ($decoded["license_status"] ?? "BLOQUEADA"),
                    $decoded["blocked_reason"] ?? ($decoded["error"] ?? null),
                );
            }
            throw new RuntimeException((string) ($decoded["error"] ?? "Servidor central respondeu HTTP {$status}."));
        }
        return $decoded["data"] ?? $decoded;
    }

    /** @param array<string,mixed> $installation @param array<string,mixed> $snapshot */
    private function applySnapshot(array $installation, array $snapshot): int
    {
        $companyId = (int) $installation["company_id"];
        $updated = 0;
        $this->connection->beginTransaction();
        try {
            $remoteLicense = is_array($snapshot["empresa"] ?? null)
                ? $snapshot["empresa"]
                : [];
            $this->syncLocalLicenseStatus(
                (string) ($remoteLicense["license_status"] ?? "ATIVA"),
                $remoteLicense["license_reason"] ?? null,
            );

            $equipmentIds = [];
            foreach (($snapshot["equipamentos"] ?? []) as $remoteEquipment) {
                $equipmentIds[(int) $remoteEquipment["id"]] = $this->upsertEquipment($companyId, $remoteEquipment);
                $updated++;
            }
            $updated += $this->removeStaleRemoteEquipment($companyId, array_keys($equipmentIds));

            $loadingIds = [];
            foreach (($snapshot["carregamentos_ativos"] ?? []) as $remoteLoading) {
                $remoteEquipmentId = filter_var($remoteLoading["equipment_id"] ?? null, FILTER_VALIDATE_INT);
                $equipmentId = null;
                if ($remoteEquipmentId !== false && $remoteEquipmentId !== null && $remoteEquipmentId > 0) {
                    $equipmentId = $equipmentIds[(int) $remoteEquipmentId]
                        ?? $this->findEquipmentId($companyId, (string) ($remoteLoading["equipment_code"] ?? ""));
                }
                if ($remoteEquipmentId !== false && $remoteEquipmentId !== null && $remoteEquipmentId > 0 && !$equipmentId) {
                    continue;
                }
                $loadingIds[(int) $remoteLoading["id"]] = $this->upsertLoading($companyId, $equipmentId, $remoteLoading);
                $updated++;
            }

            $remoteLoadingIds = array_keys($loadingIds);
            if ($remoteLoadingIds === []) {
                $finishStale = $this->connection->prepare(
                    "UPDATE carregamentos
                     SET state = 'FINALIZADO', finished_at = COALESCE(finished_at, NOW(3))
                     WHERE company_id = :company_id AND remote_carregamento_id IS NOT NULL
                       AND state <> 'FINALIZADO'",
                );
                $finishStale->execute(["company_id" => $companyId]);
            } else {
                $placeholders = implode(",", array_fill(0, count($remoteLoadingIds), "?"));
                $finishStale = $this->connection->prepare(
                    "UPDATE carregamentos
                     SET state = 'FINALIZADO', finished_at = COALESCE(finished_at, NOW(3))
                     WHERE company_id = ? AND remote_carregamento_id IS NOT NULL
                       AND state <> 'FINALIZADO' AND remote_carregamento_id NOT IN ({$placeholders})",
                );
                $finishStale->execute([$companyId, ...$remoteLoadingIds]);
            }

            $adminId = $this->localAdminId($companyId);
            if ($adminId) {
                foreach (($snapshot["comandos"] ?? []) as $remoteCommand) {
                    $loadingId = $loadingIds[(int) ($remoteCommand["carregamento_id"] ?? 0)]
                        ?? $this->findLoadingId($companyId, (int) ($remoteCommand["carregamento_id"] ?? 0));
                    $equipmentId = $equipmentIds[(int) ($remoteCommand["equipment_id"] ?? 0)]
                        ?? $this->findEquipmentId($companyId, (string) ($remoteCommand["equipment_code"] ?? ""));
                    if (!$loadingId || !$equipmentId) {
                        continue;
                    }
                    $this->upsertCommand($companyId, $equipmentId, $loadingId, $adminId, $remoteCommand);
                    $updated++;
                }
            }

            $statement = $this->connection->prepare(
                "UPDATE instalacoes_locais
                 SET last_remote_sync_at = NOW(3), last_remote_sync_error = NULL
                 WHERE id = 1",
            );
            $statement->execute();
            $this->connection->commit();
            return $updated;
        } catch (Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            throw $exception;
        }
    }

    /** @param list<int> $remoteEquipmentIds */
    private function removeStaleRemoteEquipment(int $companyId, array $remoteEquipmentIds): int
    {
        $remoteEquipmentIds = array_values(array_unique(array_filter(
            array_map(static fn (mixed $id): int => (int) $id, $remoteEquipmentIds),
            static fn (int $id): bool => $id > 0,
        )));
        $where = ["company_id = :company_id", "remote_equipment_id IS NOT NULL"];
        $params = ["company_id" => $companyId];
        if ($remoteEquipmentIds !== []) {
            $placeholders = [];
            foreach ($remoteEquipmentIds as $index => $remoteId) {
                $key = "remote_equipment_id_{$index}";
                $placeholders[] = ":{$key}";
                $params[$key] = $remoteId;
            }
            $where[] = "remote_equipment_id NOT IN (" . implode(",", $placeholders) . ")";
        }
        $stale = $this->connection->prepare(
            "SELECT id FROM equipamentos WHERE " . implode(" AND ", $where) . " ORDER BY id",
        );
        $stale->execute($params);
        $removed = 0;
        foreach ($stale->fetchAll() as $row) {
            $equipmentId = (int) $row["id"];
            $dependencies = $this->connection->prepare(
                "SELECT
                    (SELECT COUNT(*) FROM carregamentos WHERE equipment_id = :equipment_id_a) +
                    (SELECT COUNT(*) FROM eventos_sensor WHERE equipment_id = :equipment_id_b) +
                    (SELECT COUNT(*) FROM imagens WHERE equipment_id = :equipment_id_c) +
                    (SELECT COUNT(*) FROM solicitacoes_captura_camera WHERE equipment_id = :equipment_id_d) +
                    (SELECT COUNT(*) FROM solicitacoes_comandos_clp WHERE equipment_id = :equipment_id_e) +
                    (SELECT COUNT(*) FROM dispositivos WHERE equipment_id = :equipment_id_f) AS total",
            );
            $dependencies->execute([
                "equipment_id_a" => $equipmentId,
                "equipment_id_b" => $equipmentId,
                "equipment_id_c" => $equipmentId,
                "equipment_id_d" => $equipmentId,
                "equipment_id_e" => $equipmentId,
                "equipment_id_f" => $equipmentId,
            ]);
            if ((int) $dependencies->fetchColumn() > 0) {
                continue;
            }
            $this->connection->prepare("DELETE FROM gatilhos_dala WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
            $this->connection->prepare("DELETE FROM acoes_dala WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
            $this->connection->prepare("DELETE FROM status_dispositivos WHERE equipment_id = :id")->execute(["id" => $equipmentId]);
            $this->connection->prepare("DELETE FROM equipamentos WHERE id = :id AND company_id = :company_id")->execute([
                "id" => $equipmentId,
                "company_id" => $companyId,
            ]);
            $removed++;
        }
        return $removed;
    }

    /** @param array<string,mixed> $remote */
    private function upsertEquipment(int $companyId, array $remote): int
    {
        $remoteId = (int) ($remote["id"] ?? 0);
        $code = trim((string) ($remote["equipment_code"] ?? ""));
        if ($remoteId <= 0 || $code === "") {
            throw new RuntimeException("Dala remota sem identificador válido.");
        }
        $find = $this->connection->prepare(
            "SELECT id FROM equipamentos WHERE company_id = :company_id
             AND (remote_equipment_id = :remote_id OR equipment_code = :equipment_code)
             LIMIT 1",
        );
        $find->execute(["company_id" => $companyId, "remote_id" => $remoteId, "equipment_code" => $code]);
        $localId = (int) ($find->fetchColumn() ?: 0);
        $data = [
            "remote_equipment_id" => $remoteId,
            "equipment_code" => $code,
            "name" => trim((string) ($remote["name"] ?? $code)),
            "plc_ip" => $remote["plc_ip"] ?? null,
            "plc_port" => (int) ($remote["plc_port"] ?? 502),
            "external_port" => $remote["external_port"] ?? null,
            "plc_protocol" => in_array(($remote["plc_protocol"] ?? "MODBUS_TCP"), ["MODBUS_TCP", "MODBUS_RTU"], true)
                ? $remote["plc_protocol"] : "MODBUS_TCP",
        ];
        if ($localId) {
            $update = $this->connection->prepare(
                "UPDATE equipamentos SET remote_equipment_id = :remote_equipment_id,
                 equipment_code = :equipment_code, name = :name, plc_ip = :plc_ip,
                 plc_port = :plc_port, external_port = :external_port, plc_protocol = :plc_protocol
                 WHERE id = :id AND company_id = :company_id",
            );
            $update->execute([...$data, "id" => $localId, "company_id" => $companyId]);
            return $localId;
        }
        $insert = $this->connection->prepare(
            "INSERT INTO equipamentos
             (company_id, remote_equipment_id, equipment_code, name, plc_ip, plc_port, external_port, plc_protocol)
             VALUES (:company_id, :remote_equipment_id, :equipment_code, :name, :plc_ip, :plc_port, :external_port, :plc_protocol)",
        );
        $insert->execute(["company_id" => $companyId, ...$data]);
        return (int) $this->connection->lastInsertId();
    }

    /** @param array<string,mixed> $remote */
    private function upsertLoading(int $companyId, ?int $equipmentId, array $remote): int
    {
        $remoteLoadingId = (int) ($remote["id"] ?? 0);
        $remoteRomaneioId = (int) ($remote["romaneio_id"] ?? 0);
        $romaneioId = $this->upsertManifest($companyId, $remoteRomaneioId, $remote);
        $truckId = $this->upsertTruck($romaneioId, (int) ($remote["truck_id"] ?? 0), $remote);
        $find = $this->connection->prepare(
            "SELECT id FROM carregamentos WHERE company_id = :company_id
             AND remote_carregamento_id = :remote_id LIMIT 1",
        );
        $find->execute(["company_id" => $companyId, "remote_id" => $remoteLoadingId]);
        $localId = (int) ($find->fetchColumn() ?: 0);
        $state = strtoupper((string) ($remote["state"] ?? "PREPARANDO"));
        $allowedStates = ["AGUARDANDO", "PREPARANDO", "CARREGANDO", "PAUSADO", "FINALIZANDO", "EMERGENCIA"];
        if (!in_array($state, $allowedStates, true)) {
            $state = "PREPARANDO";
        }
        if ($localId) {
            $update = $this->connection->prepare(
                "UPDATE carregamentos SET equipment_id = :equipment_id, romaneio_id = :romaneio_id,
                 truck_id = :truck_id, state = :state, started_at = :started_at
                 WHERE id = :id AND company_id = :company_id",
            );
            $update->execute([
                "equipment_id" => $equipmentId,
                "romaneio_id" => $romaneioId,
                "truck_id" => $truckId,
                "state" => $state,
                "started_at" => $remote["started_at"] ?? null,
                "id" => $localId,
                "company_id" => $companyId,
            ]);
        } else {
            $insert = $this->connection->prepare(
                "INSERT INTO carregamentos
                 (company_id, remote_carregamento_id, equipment_id, romaneio_id, truck_id, state, started_at)
                 VALUES (:company_id, :remote_id, :equipment_id, :romaneio_id, :truck_id, :state, :started_at)",
            );
            $insert->execute([
                "company_id" => $companyId,
                "remote_id" => $remoteLoadingId,
                "equipment_id" => $equipmentId,
                "romaneio_id" => $romaneioId,
                "truck_id" => $truckId,
                "state" => $state,
                "started_at" => $remote["started_at"] ?? null,
            ]);
            $localId = (int) $this->connection->lastInsertId();
        }
        $this->syncItems($romaneioId, $companyId, $remote["items"] ?? []);
        return $localId;
    }

    /** @param array<string,mixed> $remote */
    private function upsertManifest(int $companyId, int $remoteId, array $remote): int
    {
        $number = trim((string) ($remote["romaneio_number"] ?? ""));
        $find = $this->connection->prepare(
            "SELECT id FROM romaneios WHERE company_id = :company_id
             AND (remote_romaneio_id = :remote_id OR number = :number) LIMIT 1",
        );
        $find->execute(["company_id" => $companyId, "remote_id" => $remoteId, "number" => $number]);
        $localId = (int) ($find->fetchColumn() ?: 0);
        $remoteStatus = strtoupper(trim((string) (
            $remote["romaneio_status"]
                ?? (is_array($remote["romaneio"] ?? null) ? ($remote["romaneio"]["status"] ?? "") : "")
        )));
        $allowedStatuses = ["IMPORTADO", "AGUARDANDO", "EM_ANDAMENTO", "FINALIZADO", "CANCELADO"];
        $status = in_array($remoteStatus, $allowedStatuses, true)
            ? $remoteStatus
            : ((string) ($remote["state"] ?? "PREPARANDO") === "FINALIZADO" ? "FINALIZADO" : "EM_ANDAMENTO");
        if ($localId) {
            $update = $this->connection->prepare(
                "UPDATE romaneios SET remote_romaneio_id = :remote_id, number = :number,
                 expedidor = :expedidor, scheduled_date = :scheduled_date, status = :status
                 WHERE id = :id AND company_id = :company_id",
            );
            $update->execute([
                "remote_id" => $remoteId,
                "number" => $number,
                "expedidor" => $remote["expedidor"] ?? null,
                "scheduled_date" => $remote["scheduled_date"] ?? date("Y-m-d"),
                "status" => $status,
                "id" => $localId,
                "company_id" => $companyId,
            ]);
            return $localId;
        }
        $insert = $this->connection->prepare(
            "INSERT INTO romaneios
             (company_id, remote_romaneio_id, number, expedidor, scheduled_date, status)
             VALUES (:company_id, :remote_id, :number, :expedidor, :scheduled_date, :status)",
        );
        $insert->execute([
            "company_id" => $companyId,
            "remote_id" => $remoteId,
            "number" => $number,
            "expedidor" => $remote["expedidor"] ?? null,
            "scheduled_date" => $remote["scheduled_date"] ?? date("Y-m-d"),
            "status" => $status,
        ]);
        return (int) $this->connection->lastInsertId();
    }

    /** @param array<string,mixed> $remote */
    private function upsertTruck(int $romaneioId, int $remoteId, array $remote): int
    {
        $plate = strtoupper(trim((string) ($remote["plate"] ?? "")));
        if (!placa_caminhao_valida($plate)) {
            throw new RuntimeException("Caminhão recebido pela sincronização é inválido.");
        }
        $find = $this->connection->prepare(
            "SELECT id FROM romaneio_caminhoes WHERE romaneio_id = :romaneio_id
             AND (remote_truck_id = :remote_id OR plate = :plate) LIMIT 1",
        );
        $find->execute(["romaneio_id" => $romaneioId, "remote_id" => $remoteId, "plate" => $plate]);
        $localId = (int) ($find->fetchColumn() ?: 0);
        if ($localId) {
            $update = $this->connection->prepare(
                "UPDATE romaneio_caminhoes SET remote_truck_id = :remote_id,
                 plate = :plate, driver_name = :driver_name WHERE id = :id",
            );
            $update->execute([
                "remote_id" => $remoteId,
                "plate" => $plate,
                "driver_name" => $remote["driver_name"] ?? null,
                "id" => $localId,
            ]);
            return $localId;
        }
        $insert = $this->connection->prepare(
            "INSERT INTO romaneio_caminhoes (romaneio_id, remote_truck_id, plate, driver_name)
             VALUES (:romaneio_id, :remote_id, :plate, :driver_name)",
        );
        $insert->execute([
            "romaneio_id" => $romaneioId,
            "remote_id" => $remoteId,
            "plate" => $plate,
            "driver_name" => $remote["driver_name"] ?? null,
        ]);
        return (int) $this->connection->lastInsertId();
    }

    /** @param list<array<string,mixed>> $items */
    private function syncItems(int $romaneioId, int $companyId, array $items): void
    {
        foreach ($items as $item) {
            $code = trim((string) ($item["code"] ?? ""));
            if ($code === "") {
                continue;
            }
            $product = $this->connection->prepare(
                "SELECT id FROM produtos WHERE company_id = :company_id AND code = :code LIMIT 1",
            );
            $product->execute(["company_id" => $companyId, "code" => $code]);
            $productId = (int) ($product->fetchColumn() ?: 0);
            if (!$productId) {
                $insertProduct = $this->connection->prepare(
                    "INSERT INTO produtos (company_id, code, name, active) VALUES (:company_id, :code, :name, 1)",
                );
                $insertProduct->execute([
                    "company_id" => $companyId,
                    "code" => $code,
                    "name" => trim((string) ($item["name"] ?? $code)),
                ]);
                $productId = (int) $this->connection->lastInsertId();
            }
            $existing = $this->connection->prepare(
                "SELECT id FROM romaneio_itens WHERE romaneio_id = :romaneio_id
                 AND product_id = :product_id AND truck_id IS NULL LIMIT 1",
            );
            $existing->execute(["romaneio_id" => $romaneioId, "product_id" => $productId]);
            $itemId = (int) ($existing->fetchColumn() ?: 0);
            if ($itemId) {
                $update = $this->connection->prepare("UPDATE romaneio_itens SET planned_quantity = :quantity WHERE id = :id");
                $update->execute(["quantity" => max(1, (int) ($item["planned_quantity"] ?? 1)), "id" => $itemId]);
            } else {
                $insert = $this->connection->prepare(
                    "INSERT INTO romaneio_itens (romaneio_id, product_id, truck_id, planned_quantity)
                     VALUES (:romaneio_id, :product_id, NULL, :quantity)",
                );
                $insert->execute([
                    "romaneio_id" => $romaneioId,
                    "product_id" => $productId,
                    "quantity" => max(1, (int) ($item["planned_quantity"] ?? 1)),
                ]);
            }
        }
    }

    private function findEquipmentId(int $companyId, string $code): ?int
    {
        if ($code === "") {
            return null;
        }
        $statement = $this->connection->prepare("SELECT id FROM equipamentos WHERE company_id = :company_id AND equipment_code = :code LIMIT 1");
        $statement->execute(["company_id" => $companyId, "code" => $code]);
        $id = $statement->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    private function findLoadingId(int $companyId, int $remoteId): ?int
    {
        if ($remoteId <= 0) {
            return null;
        }
        $statement = $this->connection->prepare("SELECT id FROM carregamentos WHERE company_id = :company_id AND remote_carregamento_id = :remote_id LIMIT 1");
        $statement->execute(["company_id" => $companyId, "remote_id" => $remoteId]);
        $id = $statement->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    private function localAdminId(int $companyId): ?int
    {
        $statement = $this->connection->prepare(
            "SELECT id FROM usuarios WHERE company_id = :company_id AND role = 'ADMIN_EMPRESA' AND active = 1 ORDER BY id LIMIT 1",
        );
        $statement->execute(["company_id" => $companyId]);
        $id = $statement->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** @param array<string,mixed> $remote */
    private function upsertCommand(int $companyId, int $equipmentId, int $loadingId, int $adminId, array $remote): void
    {
        $remoteId = (int) ($remote["id"] ?? 0);
        $find = $this->connection->prepare(
            "SELECT id FROM solicitacoes_comandos_clp WHERE company_id = :company_id
             AND remote_command_id = :remote_id LIMIT 1",
        );
        $find->execute(["company_id" => $companyId, "remote_id" => $remoteId]);
        $localId = (int) ($find->fetchColumn() ?: 0);
        $status = strtoupper((string) ($remote["status"] ?? "PENDENTE"));
        if (!in_array($status, ["PENDENTE", "PROCESSANDO", "APLICADO", "REJEITADO", "ERRO"], true)) {
            $status = "PENDENTE";
        }
        if ($localId) {
            $update = $this->connection->prepare(
                "UPDATE solicitacoes_comandos_clp SET status = :status, response_message = :message,
                 completed_at = :completed_at WHERE id = :id AND company_id = :company_id",
            );
            $update->execute([
                "status" => $status,
                "message" => $remote["response_message"] ?? null,
                "completed_at" => $remote["completed_at"] ?? null,
                "id" => $localId,
                "company_id" => $companyId,
            ]);
            return;
        }
        $insert = $this->connection->prepare(
            "INSERT INTO solicitacoes_comandos_clp
             (company_id, remote_command_id, equipment_id, carregamento_id, command, status, requested_by, requested_at, response_message, completed_at)
             VALUES (:company_id, :remote_id, :equipment_id, :loading_id, :command, :status, :requested_by, :requested_at, :message, :completed_at)",
        );
        $insert->execute([
            "company_id" => $companyId,
            "remote_id" => $remoteId,
            "equipment_id" => $equipmentId,
            "loading_id" => $loadingId,
            "command" => (string) ($remote["command"] ?? "REVERSAO_ATIVAR"),
            "status" => $status,
            "requested_by" => $adminId,
            "requested_at" => $remote["requested_at"] ?? date("Y-m-d H:i:s.v"),
            "message" => $remote["response_message"] ?? null,
            "completed_at" => $remote["completed_at"] ?? null,
        ]);
    }

    private function sendHeartbeats(string $centralUrl, string $token, int $companyId): void
    {
        $statement = $this->connection->prepare(
            "SELECT e.remote_equipment_id, e.equipment_code, s.device_type, s.status, s.last_seen_at
             FROM status_dispositivos s JOIN equipamentos e ON e.id = s.equipment_id
             WHERE e.company_id = :company_id",
        );
        $statement->execute(["company_id" => $companyId]);
        $heartbeats = array_map(static fn (array $row): array => [
            "remote_equipment_id" => $row["remote_equipment_id"] === null ? null : (int) $row["remote_equipment_id"],
            "equipment_code" => $row["equipment_code"],
            "device_type" => $row["device_type"],
            "status" => $row["status"],
            "last_seen_at" => $row["last_seen_at"],
        ], $statement->fetchAll());
        if ($heartbeats === []) {
            return;
        }
        $this->request(
            rtrim($centralUrl, "/") . "/api/sincronizacao_instalacao.php",
            $token,
            "POST",
            ["action" => "heartbeat", "heartbeats" => $heartbeats],
        );
    }

    private function markError(string $message): void
    {
        $statement = $this->connection->prepare(
            "UPDATE instalacoes_locais SET last_remote_sync_error = :error WHERE id = 1",
        );
        $statement->execute(["error" => mb_substr($message, 0, 1000)]);
    }

    private function syncLocalLicenseStatus(string $status, mixed $reason): void
    {
        $normalizedStatus = strtoupper(trim($status)) === "ATIVA" ? "ATIVA" : "BLOQUEADA";
        $blockedReason = trim((string) ($reason ?? ""));

        try {
            $companyId = (int) ($this->connection->query(
                "SELECT company_id FROM instalacoes_locais WHERE id = 1 LIMIT 1",
            )->fetchColumn() ?: 0);
            if ($companyId < 1) {
                return;
            }

            $statement = $this->connection->prepare(
                "INSERT INTO licencas (company_id, plan_name, billing_period, status, blocked_at, blocked_reason)
                 VALUES (:company_id, 'Trace Mensal', 'MENSAL', :status, :blocked_at, :blocked_reason)
                 ON DUPLICATE KEY UPDATE status = VALUES(status), blocked_at = VALUES(blocked_at),
                     blocked_reason = VALUES(blocked_reason)",
            );
            $statement->execute([
                "company_id" => $companyId,
                "status" => $normalizedStatus,
                "blocked_at" => $normalizedStatus === "ATIVA" ? null : date("Y-m-d H:i:s"),
                "blocked_reason" => $normalizedStatus === "ATIVA"
                    ? null
                    : mb_substr($blockedReason !== "" ? $blockedReason : "Licença bloqueada no servidor central.", 0, 255),
            ]);
        } catch (Throwable $exception) {
            error_log("Não foi possível atualizar o estado local da licença: " . $exception->getMessage());
        }
    }
}
