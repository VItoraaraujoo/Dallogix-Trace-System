<?php
declare(strict_types=1);

namespace App\Aplicacao;

use PDO;
use RuntimeException;
use Throwable;

final class ExcecaoComandoClp extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus,
    ) {
        parent::__construct($message);
    }
}

final class ServicoComandoClp
{
    private const REVERSAL_COMMANDS = ["REVERSAO_ATIVAR", "REVERSAO_DESATIVAR"];
    private const EMERGENCY_COMMAND = "EMERGENCIA";

    private readonly PDO $connection;
    private readonly ServicoDisponibilidadeClp $disponibilidadeClp;

    public function __construct(PDO $connection)
    {
        $this->connection = $connection;
        $this->disponibilidadeClp = new ServicoDisponibilidadeClp($connection);
    }

    /** @param array{id:int|string, company_id:int|string|null} $user */
    public function requestReversal(
        array $user,
        int $loadingId,
        string $command,
    ): array {
        if (!in_array($command, self::REVERSAL_COMMANDS, true)) {
            throw new ExcecaoComandoClp(
                "Carregamento e comando de reversão válido são obrigatórios.",
                422,
            );
        }
        if ($user["company_id"] === null) {
            throw new ExcecaoComandoClp(
                "Usuário sem empresa vinculada.",
                403,
            );
        }

        $this->connection->beginTransaction();
        try {
            $loading = $this->findLoading($loadingId, (int) $user["company_id"]);
            if (!$loading) {
                throw new ExcecaoComandoClp(
                    "Carregamento não encontrado para esta empresa.",
                    404,
                );
            }
            if ($loading["state"] !== "PAUSADO") {
                throw new ExcecaoComandoClp(
                    "Para alterar a reversão, pare a máquina primeiro.",
                    409,
                );
            }
            $this->disponibilidadeClp->validarComando(
                (int) $user["company_id"],
                (int) $loading["equipment_id"],
            );
            if ($this->hasPendingCommand($loadingId)) {
                throw new ExcecaoComandoClp(
                    "Já existe um comando de reversão aguardando o gateway industrial.",
                    409,
                );
            }
            $insert = $this->connection
                ->prepare("INSERT INTO solicitacoes_comandos_clp
                (company_id, equipment_id, carregamento_id, command, requested_by)
                VALUES (:company_id, :equipment_id, :carregamento_id, :command, :requested_by)");
            $insert->execute([
                "company_id" => $user["company_id"],
                "equipment_id" => $loading["equipment_id"],
                "carregamento_id" => $loadingId,
                "command" => $command,
                "requested_by" => $user["id"],
            ]);
            $requestId = (int) $this->connection->lastInsertId();
            \record_operational_event(
                $this->connection,
                $user,
                $command,
                "plc_command_request",
                $requestId,
                [
                    "command" => $command,
                    "carregamento_id" => $loadingId,
                    "equipment_id" => (int) $loading["equipment_id"],
                    "remote_carregamento_id" => $loading["remote_carregamento_id"] === null
                        ? null : (int) $loading["remote_carregamento_id"],
                    "requires_clp_adapter" => true,
                ],
            );
            $this->connection->commit();
        } catch (Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            if ($exception instanceof ExcecaoComandoClp || $exception instanceof ExcecaoDisponibilidadeClp) {
                throw $exception;
            }
            error_log(
                "PLC command request could not be created: " .
                    $exception->getMessage(),
            );
            throw new ExcecaoComandoClp(
                "Não foi possível registrar a solicitação de reversão.",
                500,
            );
        }

        return [
            "command_request_id" => $requestId,
            "carregamento_id" => $loadingId,
            "equipment_id" => (int) $loading["equipment_id"],
            "command" => $command,
            "state" => $loading["state"],
            "message" =>
                ($command === "REVERSAO_ATIVAR"
                    ? "Ativação da reversão registrada."
                    : "Desativação da reversão registrada.") .
                " O gateway industrial deverá validar os intertravamentos antes de enviar o comando ao CLP.",
        ];
    }

    /** @param array{id:int|string, company_id:int|string|null} $user */
    public function requestEmergency(array $user, int $loadingId): array
    {
        if ($user["company_id"] === null) {
            throw new ExcecaoComandoClp("Usuário sem empresa vinculada.", 403);
        }

        $this->connection->beginTransaction();
        try {
            $loading = $this->findLoading($loadingId, (int) $user["company_id"]);
            if (!$loading) {
                throw new ExcecaoComandoClp(
                    "Carregamento não encontrado para esta empresa.",
                    404,
                );
            }
            if ($loading["state"] === "FINALIZADO") {
                throw new ExcecaoComandoClp(
                    "Não é possível acionar emergência em um carregamento finalizado.",
                    409,
                );
            }

            // O desbloqueio é revogado mesmo se esta emergência já estiver
            // pendente: um novo pedido do operador invalida qualquer ACK
            // de desbloqueio ainda em voo.
            $this->cancelPendingUnlocks($user, $loadingId);

            $pending = $this->pendingCommand($loadingId, self::EMERGENCY_COMMAND);
            if ($pending) {
                if ($loading["state"] !== "EMERGENCIA") {
                    $this->setEmergencyState($user, $loadingId, $loading);
                }
                $this->connection->commit();
                return [
                    "command_request_id" => (int) $pending["id"],
                    "carregamento_id" => $loadingId,
                    "equipment_id" => (int) $loading["equipment_id"],
                    "command" => self::EMERGENCY_COMMAND,
                    "status" => (string) $pending["status"],
                    "state" => "EMERGENCIA",
                    "message" => "A emergência já está registrada e aguarda confirmação do gateway industrial.",
                ];
            }

            if ($loading["state"] !== "EMERGENCIA") {
                $this->setEmergencyState($user, $loadingId, $loading);
            }

            $insert = $this->connection->prepare(
                "INSERT INTO solicitacoes_comandos_clp
                (company_id, equipment_id, carregamento_id, command, requested_by)
                VALUES (:company_id, :equipment_id, :carregamento_id, :command, :requested_by)",
            );
            $insert->execute([
                "company_id" => $user["company_id"],
                "equipment_id" => $loading["equipment_id"],
                "carregamento_id" => $loadingId,
                "command" => self::EMERGENCY_COMMAND,
                "requested_by" => $user["id"],
            ]);
            $requestId = (int) $this->connection->lastInsertId();
            \record_operational_event(
                $this->connection,
                $user,
                self::EMERGENCY_COMMAND,
                "plc_command_request",
                $requestId,
                [
                    "command" => self::EMERGENCY_COMMAND,
                    "carregamento_id" => $loadingId,
                    "equipment_id" => (int) $loading["equipment_id"],
                    "remote_carregamento_id" => $loading["remote_carregamento_id"] === null
                        ? null : (int) $loading["remote_carregamento_id"],
                    "requires_clp_adapter" => true,
                    "safety_priority" => true,
                ],
            );
            $this->connection->commit();
        } catch (Throwable $exception) {
            if ($this->connection->inTransaction()) {
                $this->connection->rollBack();
            }
            if ($exception instanceof ExcecaoComandoClp) {
                throw $exception;
            }
            error_log("PLC emergency request could not be created: " . $exception->getMessage());
            throw new ExcecaoComandoClp(
                "Não foi possível registrar a emergência.",
                500,
            );
        }

        return [
            "command_request_id" => $requestId,
            "carregamento_id" => $loadingId,
            "equipment_id" => (int) $loading["equipment_id"],
            "command" => self::EMERGENCY_COMMAND,
            "status" => "PENDENTE",
            "state" => "EMERGENCIA",
            "message" => "Emergência registrada. A parada física aguarda confirmação do gateway/CLP; use também o botão físico de emergência se necessário.",
        ];
    }

    private function findLoading(int $loadingId, int $companyId): array|false
    {
        $statement = $this->connection->prepare(
            "SELECT id, state, equipment_id, remote_carregamento_id
             FROM carregamentos WHERE id = :id AND company_id = :company_id LIMIT 1 FOR UPDATE",
        );
        $statement->execute(["id" => $loadingId, "company_id" => $companyId]);
        return $statement->fetch();
    }

    private function hasPendingCommand(int $loadingId): bool
    {
        return $this->pendingCommand($loadingId) !== false;
    }

    private function pendingCommand(int $loadingId, ?string $command = null): array|false
    {
        $where = "carregamento_id = :carregamento_id AND status IN ('PENDENTE', 'PROCESSANDO')";
        $params = ["carregamento_id" => $loadingId];
        if ($command !== null) {
            $where .= " AND command = :command";
            $params["command"] = $command;
        }
        $statement = $this->connection->prepare(
            "SELECT id, status FROM solicitacoes_comandos_clp
             WHERE {$where} ORDER BY id DESC LIMIT 1 FOR UPDATE",
        );
        $statement->execute($params);
        return $statement->fetch();
    }

    /** @param array{id:int|string, company_id:int|string|null} $user */
    private function cancelPendingUnlocks(array $user, int $loadingId): void
    {
        $pending = $this->connection->prepare(
            "SELECT r.id, r.equipment_id, r.remote_command_id,
                    c.remote_carregamento_id, e.remote_equipment_id, e.equipment_code
             FROM solicitacoes_comandos_clp r
             JOIN carregamentos c ON c.id = r.carregamento_id
             JOIN equipamentos e ON e.id = r.equipment_id
             WHERE r.carregamento_id = :loading_id AND r.company_id = :company_id
               AND r.command = 'DESBLOQUEAR_MAQUINA'
               AND r.status IN ('PENDENTE', 'PROCESSANDO')
             ORDER BY r.id FOR UPDATE",
        );
        $pending->execute([
            "loading_id" => $loadingId,
            "company_id" => $user["company_id"],
        ]);
        $cancel = $this->connection->prepare(
            "UPDATE solicitacoes_comandos_clp
             SET status = 'REJEITADO', completed_at = NOW(3),
                 response_message = 'Nova emergência cancelou o desbloqueio pendente.'
             WHERE id = :id AND status IN ('PENDENTE', 'PROCESSANDO')",
        );
        foreach ($pending->fetchAll() as $request) {
            $cancel->execute(["id" => $request["id"]]);
            if ($cancel->rowCount() !== 1) {
                continue;
            }
            \record_operational_event(
                $this->connection,
                $user,
                "COMANDO_CLP_CONCLUIDO",
                "solicitacao_comando_clp",
                (int) $request["id"],
                [
                    "equipment_id" => (int) $request["equipment_id"],
                    "carregamento_id" => $loadingId,
                    "command" => "DESBLOQUEAR_MAQUINA",
                    "status" => "REJEITADO",
                    "message" => "Nova emergência cancelou o desbloqueio pendente.",
                    "remote_command_id" => $request["remote_command_id"] === null
                        ? null : (int) $request["remote_command_id"],
                    "remote_carregamento_id" => $request["remote_carregamento_id"] === null
                        ? null : (int) $request["remote_carregamento_id"],
                    "remote_equipment_id" => $request["remote_equipment_id"] === null
                        ? null : (int) $request["remote_equipment_id"],
                    "equipment_code" => $request["equipment_code"],
                ],
            );
        }
    }

    /** @param array<string,mixed> $loading */
    private function setEmergencyState(array $user, int $loadingId, array $loading): void
    {
        $update = $this->connection->prepare(
            "UPDATE carregamentos SET state = 'EMERGENCIA'
             WHERE id = :id AND company_id = :company_id AND state = :previous_state",
        );
        $update->execute([
            "id" => $loadingId,
            "company_id" => $user["company_id"],
            "previous_state" => $loading["state"],
        ]);
        if ($update->rowCount() !== 1) {
            throw new ExcecaoComandoClp(
                "O estado do carregamento mudou. Atualize a operação antes de acionar a emergência.",
                409,
            );
        }
        \record_operational_event(
            $this->connection,
            $user,
            "ESTADO_CARREGAMENTO_ALTERADO",
            "carregamento",
            $loadingId,
            [
                "previous_state" => $loading["state"],
                "state" => "EMERGENCIA",
                "remote_carregamento_id" => $loading["remote_carregamento_id"] === null
                    ? null : (int) $loading["remote_carregamento_id"],
                "safety_priority" => true,
            ],
        );
    }
}
