# Pendências para decisão da empresa

Este documento acompanha configurações, implementação e validações ainda necessárias para a entrega. Decisões de negócio já tomadas e o mapa aprovado ficam registrados como concluídos; itens que exigem acesso físico continuam marcados como pendentes de homologação.

> Atualizado em 15/10/2026. O modelo do CLP e o mapa de comandos já foram informados e aprovados; esta lista registra o que ainda depende de configuração ou validação física.

## 1. Câmera IP

- Fabricante e modelo: **Hikvision DS-2CD2121G0-I**.
- Interface e protocolo previstos: **Ethernet/RJ45, RTSP sobre TCP, porta 554, canal 101**.
- Endereço: o HiTools Delivery no PC mostrou `192.168.50.10` como **Off-line**; esse endereço ainda é apenas um candidato, não confirmado como IP atual da câmera.
- Credencial: criar/configurar usuário dedicado somente para visualização; não registrar a senha neste documento.
- Intervalo/pre-buffer: validar em bancada com o fluxo real da esteira.

Impacto: o worker RTSP e a geração de evidência PDF estão implementados. A câmera ainda não entregou quadros: faltam endereço alcançável pelo PC, credencial RTSP configurada localmente e teste de captura.

## 2. CLP

- Fabricante/modelo informado: **INVT TS621**. Registrar também o sufixo exato da etiqueta antes de validar a ligação elétrica.
- IP/porta cadastrados na Dala: `192.168.1.10:502`; confirmar a topologia final da bancada.
- Protocolo: **Modbus TCP por Ethernet**.
- Mapa aprovado: `M2049` comando da esteira, `M2050` reversão, `M2051` emergência, `M17` retorno da emergência e `M2052` registro de contagem do sensor, lido por FC3.
- Retorno de movimento da esteira: **não configurado**; o Central mostra “sem retorno de movimento configurado”.
- Comportamento em perda de comunicação: ainda precisa de aceite no Ladder e teste físico.

Impacto: o gateway Modbus e as travas por mapa/aprovação existem. A última leitura somente de consulta em 15/10/2026 mostrou `M17=1` (emergência ativa segundo o gateway), `M2049=0`, `M2050=0` e `M2051=1`. Nenhuma escrita foi enviada nessa leitura; com o motor ausente e o retorno de movimento sem configuração, a resposta física ainda não está homologada.

## 3. Scanner

- Modelo: **Elgin EL8600**.
- Interface definida: **USB como teclado (HID)**.
- Modo operacional: **leitura contínua, sempre ativo**.
- Formato/prefixo/sufixo enviados pelo scanner: verificar quando o leitor estiver conectado.
- Estado na bancada em 15/10/2026: **desconectado**.

Impacto: a tela mantém o campo de leitura focado para o teclado USB e o fluxo `SEM_LEITURA` existe. A integração publicada ainda não correlaciona o evento de sensor do CLP com o código lido; falta implementar e testar essa associação com o sensor conectado.

## 4. Cloud AWS

- Conta e região:
- URL pública da API:
- Estratégia de banco: gerenciado ou container:
- Armazenamento remoto e backup dos PDFs de auditoria:
- Domínio e certificado:
- Política de retenção e backup:

Impacto: o projeto usa `SYNC_REMOTE_URL` e permanece portátil para futura migração a servidor próprio.

## 5. Operação — definido

- Retenção de imagens de incidentes: **30 dias**.
- Liberação de emergência: `ADMIN_EMPRESA` e `SUPERVISOR`. O perfil `USUARIO` não pode liberar a emergência; `ADMIN_DALLOGIX` acompanha empresas sem operar suas máquinas.
- Aprovação para finalizar carregamento: **não necessária**.
- Produto incorreto e retorno: incidentes do romaneio, com ocorrência e foto.
- Excesso: não será tratado como incidente; ao atingir a quantidade planejada, a máquina deve alertar e o carregamento deve avançar para finalização.

## 6. Ainda pendente

- Configurar e testar um sinal de retorno de movimento separado do comando de saída; não reutilizar o retorno M17 da emergência como estado da esteira.
- Integrar a leitura do sensor do CLP ao evento de saco e associar esse evento à leitura USB.
- Testar ausência de leitura após o sensor: registro `SEM_LEITURA`, pausa controlada e captura de evidência pela câmera.
- Validar em bancada o comportamento seguro na perda de comunicação com o PC.
- Confirmar o texto/alarme exibido ao operador quando a quantidade planejada for atingida.

## 7. Licenciamento — definido

- Modelo: status manual por empresa, sem data de vencimento.
- Controle: o `ADMIN_DALLOGIX` pode bloquear ou desbloquear a empresa.
- Cobrança automática e vencimento: não serão implementados.
- Ao bloquear: o Trace impede novas preparações, início de carregamento e comandos operacionais, sem desligar carga em andamento ou alterar intertravamentos do CLP.

## 8. Portal administrativo

- Hospedagem e domínio do painel de gestão:
- Autenticação e política de acesso remoto:
- Sistemas e servidores que entram no painel:
- Ações remotas permitidas (consulta, atualização, reinício e outras):
- Separação e retenção de logs, auditoria e backups:

Impacto: o Trace já oferece a área `ADMIN_DALLOGIX` para empresas, usuários e diagnóstico/logs. A expansão para gerir servidores e integrações precisa destes limites antes de expor ações administrativas remotas. O estado da execução está em `documentacao/operacao/plano-execucao-consolidado.md`.
