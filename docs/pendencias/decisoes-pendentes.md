# Pendências para decisão da empresa

Este documento reúne apenas decisões que dependem de informações externas ou confirmação do negócio. O desenvolvimento local-first continua sem bloquear essas decisões.

## 1. Câmera IP

- Fabricante e modelo:
- Endereço IP ou DHCP reservado:
- Protocolo disponível: RTSP, HTTP snapshot, ONVIF ou outro:
- Credencial técnica:
- Intervalo/pre-buffer necessário para capturar sacos em alta velocidade:

Impacto: o Node-RED já possui o worker protegido; falta implementar o adaptador específico do modelo.

## 2. CLP

- Fabricante/modelo de referência: **Delta DVP14SS**.
- Sufixo/variante exata:
- IP e porta:
- Protocolo: **preferencialmente Modbus RTU via RS-485**; confirmar na variante instalada.
- Mapa de registradores:
- Sinais de sensor, iniciar, parar, pausa e emergência:
- Comportamento seguro em perda de comunicação:

Impacto: os estados do backend já existem; a comunicação real não deve ser inventada sem esses dados.

## 3. Scanner

- Modelo: **Elgin EL8600**.
- Interface disponível: **USB ou RS-232**; a instalação deve escolher uma delas.
- Modo operacional: **leitura contínua, sempre ativo**.
- Formato enviado pelo scanner:
- Timeout de leitura:
- Código de término da leitura:

Impacto: o fluxo `SEM_LEITURA` já está persistido. O driver do PC industrial manterá o scanner ouvindo continuamente; o evento do sensor do CLP será usado para associar a leitura ao saco correto. Não será necessário ligar/desligar o scanner a cada saco.

## 4. Cloud AWS

- Conta e região:
- URL pública da API:
- Estratégia de banco: gerenciado ou container:
- Armazenamento de imagens:
- Domínio e certificado:
- Política de retenção e backup:

Impacto: o projeto usa `SYNC_REMOTE_URL` e permanece portátil para futura migração a servidor próprio.

## 5. Operação — definido

- Retenção de imagens de incidentes: **30 dias**.
- Liberação de emergência: todos os perfis, exceto `OPERADOR`.
- Aprovação para finalizar carregamento: **não necessária**.
- Produto incorreto e retorno: incidentes do romaneio, com ocorrência e foto.
- Excesso: não será tratado como incidente; ao atingir a quantidade planejada, a máquina deve alertar e o carregamento deve avançar para finalização.

## 6. Ainda pendente

- Confirmar se retorno será identificado por sinal do CLP, modo manual ou ambos.
- Confirmar o texto/alarme exibido ao operador quando a quantidade planejada for atingida.
