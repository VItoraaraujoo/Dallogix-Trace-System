# Pendências para decisão da empresa

Este documento acompanha configurações, implementação e validações ainda necessárias para a entrega. Decisões de negócio já tomadas e o mapa aprovado ficam registrados como concluídos; itens que exigem acesso físico continuam marcados como pendentes de homologação.

> Atualizado em 15/10/2026. O modelo do CLP e o mapa de comandos já foram informados e aprovados; esta lista registra o que ainda depende de configuração ou validação física.

## 1. Leitor Keyence SR-X100W

- O mesmo equipamento envia códigos por TCP e imagens de erro por FTP passivo.
- Configurar `Timing Mode = Standard`, um trigger por passagem M2052 e uma leitura por trigger; validar como o pulso isolado do CLP chegará à entrada de trigger do leitor.
- Confirmar IP fixo do PC industrial e do leitor, formato/delimitador do código e configuração de imagem de erro.
- Definir usuário e senha exclusivos do FTP no `.env`; não registrar a senha neste documento.
- Validar tamanho, resolução, latência e correspondência temporal das imagens em bancada.

Impacto: o worker local recebe códigos e JPEGs do Keyence e grava imagens de incidentes na evidência do carregamento. A configuração física e a homologação do SR-X100W continuam pendentes.

## 2. CLP

- Fabricante/modelo informado: **INVT TS621**. Registrar também o sufixo exato da etiqueta antes de validar a ligação elétrica.
- IP/porta cadastrados na Dala: `192.168.1.10:502`; confirmar a topologia final da bancada.
- Protocolo: **Modbus TCP por Ethernet**.
- Mapa aprovado: `M2049` comando da esteira, `M2050` reversão, `M2051` emergência, `M17` retorno da emergência e `M2052` sensor. O gateway agora lê M2052 por FC1 a cada 200 ms; a configuração local padrão registra a borda de subida, com `rising_edge`, `falling_edge` ou `toggle` disponíveis. Ainda falta homologar no Ladder qual modo representa exatamente uma passagem. Pulsos menores que 200 ms podem ser perdidos e precisam de alargamento/latch no CLP ou polling mais rápido validado.
- Retorno de movimento da esteira: **não configurado**; o Central mostra “sem retorno de movimento configurado”.
- Comportamento em perda de comunicação: ainda precisa de aceite no Ladder e teste físico.

Impacto: o gateway Modbus e as travas por mapa/aprovação existem. A última leitura somente de consulta em 15/10/2026 mostrou `M17=1` (emergência ativa segundo o gateway), `M2049=0`, `M2050=0` e `M2051=1`. Nenhuma escrita foi enviada nessa leitura; com o motor ausente e o retorno de movimento sem configuração, a resposta física ainda não está homologada.

## 3. Cloud AWS

- Conta e região:
- URL pública da API:
- Estratégia de banco: gerenciado ou container:
- Armazenamento remoto e backup dos PDFs de auditoria:
- Domínio e certificado:
- Política de retenção e backup:

Impacto: o projeto usa `SYNC_REMOTE_URL` e permanece portátil para futura migração a servidor próprio.

## 4. Operação — definido

- Retenção de imagens de incidentes: **30 dias**.
- Liberação de emergência: `ADMIN_EMPRESA` e `SUPERVISOR`. O perfil `USUARIO` não pode liberar a emergência; `ADMIN_DALLOGIX` acompanha empresas sem operar suas máquinas.
- Aprovação para finalizar carregamento: **não necessária**.
- Produto incorreto e retorno: incidentes do romaneio, com ocorrência e foto.
- Excesso: não será tratado como incidente; ao atingir a quantidade planejada, a máquina deve alertar e o carregamento deve avançar para finalização.

## 5. Ainda pendente

- Configurar e testar um sinal de retorno de movimento separado do comando de saída; não reutilizar o retorno M17 da emergência como estado da esteira.
- Integrar e homologar o sensor do CLP com os códigos e imagens do Keyence.
- Testar ausência de leitura após o sensor: aguardar `TRACE_SCANNER_NO_READ_TIMEOUT_MS` (padrão 1500 ms), confirmar registro único `SEM_LEITURA` e a imagem de erro do Keyence no relatório.
- Validar em bancada o comportamento seguro na perda de comunicação com o PC.
- Confirmar o texto/alarme exibido ao operador quando a quantidade planejada for atingida.

## 6. Licenciamento — definido

- Modelo: status manual por empresa, sem data de vencimento.
- Controle: o `ADMIN_DALLOGIX` pode bloquear ou desbloquear a empresa.
- Cobrança automática e vencimento: não serão implementados.
- Ao bloquear: o Trace impede novas preparações, início de carregamento e comandos operacionais, sem desligar carga em andamento ou alterar intertravamentos do CLP.

## 7. Portal administrativo

- Hospedagem e domínio do painel de gestão:
- Autenticação e política de acesso remoto:
- Sistemas e servidores que entram no painel:
- Ações remotas permitidas (consulta, atualização, reinício e outras):
- Separação e retenção de logs, auditoria e backups:

Impacto: o Trace já oferece a área `ADMIN_DALLOGIX` para empresas, usuários e diagnóstico/logs. A expansão para gerir servidores e integrações precisa destes limites antes de expor ações administrativas remotas. O estado da execução está em `documentacao/operacao/plano-execucao-consolidado.md`.
