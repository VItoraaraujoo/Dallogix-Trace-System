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

- Fabricante/modelo confirmado:
- IP e porta:
- Protocolo:
- Mapa de registradores:
- Sinais de sensor, iniciar, parar, pausa e emergência:
- Comportamento seguro em perda de comunicação:

Impacto: os estados do backend já existem; a comunicação real não deve ser inventada sem esses dados.

## 3. Scanner

- Modelo/interface:
- USB, serial, TCP/IP ou teclado HID:
- Formato enviado pelo scanner:
- Timeout de leitura:
- Código de término da leitura:

Impacto: o fluxo `SEM_LEITURA` já está persistido; falta conectar o driver físico.

## 4. Cloud AWS

- Conta e região:
- URL pública da API:
- Estratégia de banco: gerenciado ou container:
- Armazenamento de imagens:
- Domínio e certificado:
- Política de retenção e backup:

Impacto: o projeto usa `SYNC_REMOTE_URL` e permanece portátil para futura migração a servidor próprio.

## 5. Operação

- Tempo de retenção de imagens de incidentes:
- Perfis autorizados a liberar emergência:
- Necessidade de aprovação para finalizar carregamento:
- Regras de excesso, retorno e produto incorreto:
