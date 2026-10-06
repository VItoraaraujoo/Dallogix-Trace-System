<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$apiDir = $root . DIRECTORY_SEPARATOR . 'servidor' . DIRECTORY_SEPARATOR . 'api';
$files = glob($apiDir . DIRECTORY_SEPARATOR . '*.php');
if ($files === false || $files === []) {
    fwrite(STDERR, "ERRO: nenhum arquivo PHP encontrado em servidor/api.\n");
    exit(2);
}

/**
 * Os arquivos diretamente em servidor/api funcionam como entradas estáveis
 * e vários deles delegam a implementação para um subdiretório. A auditoria
 * precisa analisar o contrato efetivo, seguindo somente includes locais
 * escritos como `require __DIR__ . "..."`; não execute código nem resolva
 * caminhos dinâmicos durante a inspeção.
 *
 * @param array<string,bool> $visited
 */
function carregar_conteudo_com_dependencias(string $file, string $root, array &$visited = []): string
{
    $canonical = realpath($file);
    $rootCanonical = realpath($root);
    if ($canonical === false || $rootCanonical === false || isset($visited[$canonical])) {
        return '';
    }
    $visited[$canonical] = true;
    $content = file_get_contents($canonical);
    if ($content === false) {
        return '';
    }

    $combined = $content;
    $pattern = '~\brequire(?:_once)?\s*\(?\s*__DIR__\s*\.\s*([\'\"])([^\'\"]+)\1\s*\)?\s*;~';
    if (preg_match_all($pattern, $content, $matches, PREG_SET_ORDER) !== false) {
        foreach ($matches as $match) {
            $relative = str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $match[2]);
            $dependency = realpath(dirname($canonical) . DIRECTORY_SEPARATOR . $relative);
            if ($dependency === false || !str_starts_with($dependency, $rootCanonical . DIRECTORY_SEPARATOR)) {
                continue;
            }
            $combined .= "\n" . carregar_conteudo_com_dependencias($dependency, $rootCanonical, $visited);
        }
    }
    return $combined;
}

$warnings = [];
foreach ($files as $file) {
    $visited = [];
    $content = carregar_conteudo_com_dependencias($file, $root, $visited);
    if ($content === '') {
        $warnings[] = ['file' => str_replace($root . DIRECTORY_SEPARATOR, '', $file), 'issues' => ['não foi possível ler o arquivo']];
        continue;
    }

    $issues = [];
    $relative = str_replace($root . DIRECTORY_SEPARATOR, '', $file);

    $retiredEndpoint = str_contains($content, 'http_response_code(410)');
    if (!$retiredEndpoint && !str_contains($content, 'configuracao/bootstrap.php')) {
        $issues[] = 'bootstrap não carregado';
    }

    $hasMethodGuard = str_contains($content, 'exigir_metodo_http(')
        || str_contains($content, 'require_csrf(')
        || str_contains($content, 'exigir_csrf(')
        || preg_match('/\$_SERVER\["REQUEST_METHOD"\]\s*(===|!==|==|!=)\s*["\'](?:GET|POST|PUT|PATCH|DELETE|OPTIONS)["\']/', $content) === 1;

    if (str_contains($content, '$_SERVER["REQUEST_METHOD"]') && !$hasMethodGuard) {
        $issues[] = 'método HTTP sem proteção explícita';
    }

    $hasSessionAuth = str_contains($content, 'exigir_sessao_usuario(')
        || str_contains($content, 'require_session_user(')
        || str_contains($content, 'require_role(')
        || str_contains($content, 'exigir_perfil(')
        || str_contains($content, 'obter_usuario_sessao(')
        || str_contains($content, 'require_device_token(')
        || str_contains($content, 'session_user(')
        || str_contains($content, 'require_internal_token(')
        || str_contains($content, 'exigir_token_interno(')
        || preg_match('/\$\w+\s*=\s*(?:require_session_user|exigir_sessao_usuario|require_internal_token|exigir_token_interno)\s*\(/', $content) === 1;

    if (str_contains($content, '$_SESSION["user"]') || str_contains($content, '$_SESSION["user"]')) {
        $hasSessionAuth = true;
    }

    if (str_contains($content, '$_SERVER["REQUEST_METHOD"]') && !$hasSessionAuth) {
        $issues[] = 'sem autenticação/autorização identificável';
    }

    if ($issues !== []) {
        $warnings[] = ['file' => $relative, 'issues' => $issues];
    }
}

printf("Auditoria de controle de acesso da API\n");
printf("Total de arquivos verificados: %d\n\n", count($files));

if ($warnings === []) {
    printf("OK: todos os endpoints principais possuem bootstrap, controle de método e autenticação/autorização observáveis.\n");
    exit(0);
}

printf("AVISOS ENCONTRADOS: %d\n\n", count($warnings));
foreach ($warnings as $warning) {
    printf("- %s\n", $warning['file']);
    foreach ($warning['issues'] as $issue) {
        printf("  * %s\n", $issue);
    }
}

exit(1);
