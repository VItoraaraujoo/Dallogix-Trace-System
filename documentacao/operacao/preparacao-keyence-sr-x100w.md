# Integração do KEYENCE SR-X100W com o Trace

**Situação:** software implementado e opcional; configuração física e homologação do SR-X100W ainda pendentes.

## Fluxo implementado

O SR-X100W envia os códigos pela conexão TCP local ao `keyence-worker` do PC industrial. O worker usa credencial de dispositivo `SCANNER`, consulta a Dala ativa, envia o código para a API de leitura do Trace e grava uma fila local idempotente para tolerar indisponibilidade curta da API.

O CLP continua registrando a passagem da saca pelo M2052. Quando o Trace encerra o tempo de leitura sem receber código, cria `SEM_LEITURA` e uma solicitação de captura. O SR-X100W envia a imagem JPEG de erro por FTP. O worker compara o horário de chegada com as solicitações pendentes e só envia a imagem quando encontra uma correspondência sem ambiguidade. A API valida a imagem, associa a solicitação ao evento da saca e grava o arquivo no armazenamento local do Trace.

Se a foto Keyence não chegar ou a correspondência não for segura, o `camera-worker` aguarda seis segundos e faz a captura RTSP existente. A câmera continua sendo a contingência. Imagens Keyence sem vínculo ficam na caixa local por até cinco minutos; depois são removidas e registradas no log. Códigos desconhecidos continuam sendo classificados pela regra atual do Trace.

Quando o último carregamento do romaneio é finalizado, a tela chama a geração do PDF final. O Trace confirma que o PDF foi gravado e validado antes de remover as fotos JPEG, os PDFs intermediários de captura e as cópias locais dessas capturas. Se a geração falhar, mantém as fontes; se a limpeza falhar depois de salvar o PDF, uma nova tentativa conclui a limpeza a partir do relatório persistido. O relatório final permanece no armazenamento local.

## Configuração do PC industrial

1. No servidor, provisionar um dispositivo `SCANNER` associado ao ID da Dala que o SR-X100W atenderá. O token deste leitor é separado dos tokens do CLP e da câmera.

   ```sh
   php scripts/provision_device.php --equipment-id=ID_DA_DALA --device-type=SCANNER --device-code=KEYENCE-SRX100W --token=TOKEN_FORTE
   ```

2. No `.env` local do Trace, configurar `KEYENCE_ENABLED=1`, `KEYENCE_DEVICE_TOKEN`, a senha FTP, o IP industrial do PC em `KEYENCE_BIND_ADDRESS` e `KEYENCE_FTP_PASV_ADDRESS`, além do IP fixo do leitor em `KEYENCE_FTP_ALLOWED_ADDRESS` e `KEYENCE_TCP_ALLOWED_ADDRESS`. A senha deve ser exclusiva do leitor.

3. Subir o perfil adicional:

   ```sh
   docker compose --profile industrial --profile keyence up -d --build
   ```

4. Liberar no firewall do PC somente a interface industrial e os IPs necessários: TCP 19000 para os códigos, TCP 2121 para FTP e TCP 21100–21109 para o modo passivo. Não publicar essas portas na rede corporativa ou na Internet. O FTP deste perfil não cifra o tráfego; mantenha o enlace isolado e limite a origem ao IP do leitor.

5. No SR-X100W, configurar o resultado de leitura como código decodificado em TCP, com delimitador CR/LF, destino no IP industrial do PC e porta 19000. Configurar imagens de erro em JPEG, envio FTP passivo para o IP do PC, porta 2121, usuário e senha do `.env`. A faixa passiva configurada deve ser 21100–21109.

Os nomes de arquivo do leitor não são usados para identificar a saca. A associação exige exatamente uma solicitação `SEM_LEITURA` pendente nos três segundos próximos à chegada; se houver duas ou mais, nenhuma é escolhida e a câmera faz a contingência. O worker espera 800 ms para completar a chegada da solicitação e mantém arquivo sem vínculo por até cinco minutos. Ajuste esses limites somente depois de medir os tempos reais em bancada.

## Variáveis adicionadas ao `.env`

| Variável | Padrão | Uso |
| --- | --- | --- |
| `KEYENCE_ENABLED` | `0` | Habilita a contingência da câmera e permite o serviço Keyence quando o perfil estiver ativo. |
| `KEYENCE_DEVICE_TOKEN` | vazio | Token `SCANNER` provisionado para a Dala. |
| `KEYENCE_BIND_ADDRESS` | `127.0.0.1` | IP da interface do PC onde as portas serão publicadas; trocar pelo IP industrial fixo. |
| `KEYENCE_TCP_PORT` | `19000` | Porta publicada para saída TCP do leitor. |
| `KEYENCE_FTP_PORT` | `2121` | Porta FTP publicada para o leitor. |
| `KEYENCE_FTP_PASSIVE_START` / `KEYENCE_FTP_PASSIVE_END` | `21100` / `21109` | Faixa passiva TCP do FTP. |
| `KEYENCE_FTP_USER` / `KEYENCE_FTP_PASSWORD` | `trace-keyence` / vazio | Conta dedicada às imagens de erro. |
| `KEYENCE_FTP_PASV_ADDRESS` | vazio | IP industrial anunciado na resposta PASV. |
| `KEYENCE_FTP_ALLOWED_ADDRESS` | vazio | IP fixo do SR-X100W; obrigatório para iniciar o worker. |
| `KEYENCE_TCP_ALLOWED_ADDRESS` | vazio | IP fixo do SR-X100W permitido na conexão de códigos; obrigatório para iniciar o worker. |
| `KEYENCE_IMAGE_MATCH_WINDOW_MS` | `3000` | Janela máxima entre a solicitação do Trace e a chegada da imagem. |
| `KEYENCE_IMAGE_SETTLE_MS` | `800` | Espera antes de tentar associar uma imagem recém-recebida. |
| `KEYENCE_IMAGE_MAX_AGE_MS` | `300000` | Prazo para imagem sem correspondência antes da remoção da caixa de entrada. |
| `KEYENCE_CAMERA_FALLBACK_DELAY_MS` | `6000` | Espera antes de a câmera reivindicar uma captura `SEM_LEITURA`. |

## Arquivos principais

- `integracoes/keyence-worker/keyence-worker.mjs`: recepção TCP, fila de leituras, heartbeat e associação das imagens.
- `integracoes/keyence-worker/ftp-receiver.mjs`: receptor FTP passivo, limitado a JPEG e a uma conta.
- `servidor/api/keyence_worker.php`: estado da Dala, solicitações de imagem, validação e armazenamento.
- `servidor/api/operacoes/leituras.php`: aceita leitura autenticada pelo dispositivo `SCANNER` e restringe à Dala vinculada.
- `servidor/api/camera/camera_worker.php`: aguarda a tentativa Keyence antes de reivindicar a contingência RTSP.
- `servidor/api/relatorios/relatorio_auditoria.php`: prepara o PDF no fechamento e limpa as fontes depois da persistência.

## Homologação necessária

O serviço possui testes locais de enquadramento TCP, parser de código, validação de correspondência temporal, login FTP, transferência de JPEG e integração com a fila `SEM_LEITURA`. Ainda é necessário validar com o equipamento real: formato e delimitador configurados no SR-X100W, modo passivo FTP, resolução/tamanho máximo das imagens, latência da foto, relógios sincronizados, duas falhas próximas, reinício com fila local, perda de API, perda de FTP e geração do PDF final.

O serviço começa desabilitado e publica portas somente quando o perfil `keyence` é solicitado. Não considere a integração homologada até esses testes físicos passarem. A página da KEYENCE Brasil disponibiliza o [Manual do Usuário da Série SR-X](https://www.keyence.com.br/support/user/barcode/sr-x/manual/) e as [especificações do SR-X100W](https://www.keyence.com/products/barcode/barcode-readers/sr-x/models/sr-x100w/).
