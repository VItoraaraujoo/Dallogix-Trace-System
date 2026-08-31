<?php
declare(strict_types=1);

namespace App\Aplicacao;

use PDO;
use RuntimeException;

final class ExcecaoEstadoCarregamento extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $httpStatus,
    ) {
        parent::__construct($message);
    }
}

final class ServicoEstadoCarregamento
{
    private const TRANSITIONS = [
        "AGUARDANDO" => ["PREPARANDO", "EMERGENCIA"],
        "PREPARANDO" => ["CARREGANDO", "PAUSADO", "EMERGENCIA"],
        "CARREGANDO" => ["PAUSADO", "FINALIZANDO", "EMERGENCIA"],
        "PAUSADO" => ["CARREGANDO", "EMERGENCIA"],
        "FINALIZANDO" => ["FINALIZADO", "EMERGENCIA"],
        "EMERGENCIA" => ["PREPARANDO"],
        "FINALIZADO" => [],
    ];

    private readonly PDO $connection;
    private readonly ServicoDisponibilidadeClp $disponibilidadeClp;

    public function __construct(PDO $connection)
    {
        $this->connection = $connection;
        $this->disponibilidadeClp = new ServicoDisponibilidadeClp($connection);
    }

    /** @param array{id:int|string, company_id:int|string|null, role:string} $user */
    public function change(array $user, int $loadingId, string $target): array
    {
        if ($user["company_id"] === null) {
            throw new ExcecaoEstadoCarregamento(
                "Usuário sem empresa vinculada.",
                403,
            );
        }
        if (!array_key_exists($target, self::TRANSITIONS)) {
            throw new ExcecaoEstadoCarregamento(
                "Carregamento e estado válido são obrigatórios.",
                422,
            );
        }

        $current = $this->findLoading($loadingId, (int) $user["company_id"]);
        if (!$current) {
            throw new ExcecaoEstadoCarregamento(
                "Carregamento não encontrado para esta empresa.",
                404,
            );
        }
        if ($target === $current["state"]) {
            return [
                "id" => $loadingId,
                "previous_state" => $current["state"],
                "state" => $target,
                "changed" => false,
            ];
        }
        if (!in_array($target, self::TRANSITIONS[$current["state"]], true)) {
            throw new ExcecaoEstadoCarregamento(
                "Transição inválida: {$current["state"]} para {$target}.",
                409,
            );
        }
        if (
            $current["state"] === "EMERGENCIA" &&
            $target === "PREPARANDO" &&
            $user["role"] === "USUARIO"
        ) {
            throw new ExcecaoEstadoCarregamento(
                "Usuário não pode liberar uma emergência.",
                403,
            );
        }
        if (in_array($target, ["CARREGANDO", "PAUSADO"], true)) {
            $this->disponibilidadeClp->validarComando(
                (int) $user["company_id"],
                (int) $current["equipment_id"],
            );
        }

        $finishedAt = $target === "FINALIZADO" ? ", finished_at = NOW()" : "";
        $update = $this->connection->prepare(
            "UPDATE carregamentos SET state = :state{$finishedAt} WHERE id = :id AND company_id = :company_id",
        );
        $update->execute([
            "state" => $target,
            "id" => $loadingId,
            "company_id" => $user["company_id"],
        ]);
        \record_operational_event(
            $this->connection,
            $user,
            "ESTADO_CARREGAMENTO_ALTERADO",
            "carregamento",
            $loadingId,
            ["previous_state" => $current["state"], "state" => $target],
        );

        return [
            "id" => $loadingId,
            "previous_state" => $current["state"],
            "state" => $target,
        ];
    }

    private function findLoading(int $loadingId, int $companyId): array|false
    {
        $statement = $this->connection->prepare(
            "SELECT id, state, equipment_id FROM carregamentos WHERE id = :id AND company_id = :company_id LIMIT 1",
        );
        $statement->execute(["id" => $loadingId, "company_id" => $companyId]);
        return $statement->fetch();
    }
}
