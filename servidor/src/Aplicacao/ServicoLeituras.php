<?php
declare(strict_types=1);

namespace App\Aplicacao;

use PDO;

final class ServicoLeituras
{
    public function __construct(private readonly PDO $connection) {}

    public function listarPendentes(int $companyId, int $loadingId, int $page = 1, int $perPage = 20): array
    {
        $perPage = max(1, min(100, $perPage));
        $count = $this->connection->prepare(
            "SELECT COUNT(*) FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id
             WHERE l.carregamento_id = :loading_id AND c.company_id = :company_id
               AND l.result = 'SEM_LEITURA'",
        );
        $count->execute(["loading_id" => $loadingId, "company_id" => $companyId]);
        $total = (int) $count->fetchColumn();
        $pages = max(1, (int) ceil($total / $perPage));
        $page = max(1, min($pages, $page));
        $offset = ($page - 1) * $perPage;
        $statement = $this->connection->prepare(
            "SELECT l.id, l.carregamento_id, l.read_at, l.result
             FROM leituras l JOIN carregamentos c ON c.id = l.carregamento_id
             WHERE l.carregamento_id = :loading_id AND c.company_id = :company_id
               AND l.result = 'SEM_LEITURA' ORDER BY l.id DESC LIMIT {$perPage} OFFSET {$offset}",
        );
        $statement->execute(["loading_id" => $loadingId, "company_id" => $companyId]);
        return [
            "data" => $statement->fetchAll(),
            "pagination" => [
                "page" => $page,
                "per_page" => $perPage,
                "total" => $total,
                "pages" => $pages,
            ],
        ];
    }
}
