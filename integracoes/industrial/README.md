# Integração industrial

Esta pasta descreve o contrato entre o PC industrial, os leitores de código e o CLP INVT TS621 informado para a bancada. O mapa aprovado e os endereços usados pelo gateway estão documentados em [`integracoes/node-red/README.md`](../node-red/README.md).

A integração do KEYENCE SR-X100W envia códigos por TCP e imagens de erro por FTP. A configuração física e a homologação estão descritas em [`documentacao/operacao/preparacao-keyence-sr-x100w.md`](../../documentacao/operacao/preparacao-keyence-sr-x100w.md).

## Responsabilidades

- Configure o SR-X100W em `Timing Mode = Standard`, com um trigger compatível por passagem M2052 e um código por trigger. O Keyence envia o resultado por TCP; o worker reserva as passagens em ordem, autentica como `SCANNER` da Dala vinculada e encaminha cada leitura para `/api/leituras.php`.
- Em `SEM_LEITURA`, o leitor envia um JPEG de erro por FTP para a pasta de entrada do PC; o Trace valida a imagem, vincula-a ao evento e a incorpora ao relatório de auditoria.
- O Node-RED monitora M2052 e publica eventos de passagem. O servidor disponibiliza eventos pendentes em ordem FIFO; o worker reserva um evento por quadro TCP e o banco impede uma segunda leitura no mesmo evento.
- Se a janela expirar sem código, o servidor registra `SEM_LEITURA` e aguarda a imagem FTP do SR-X100W. Se a imagem não chegar ou a associação for ambígua, a solicitação termina com erro e o relatório mantém o registro da falha.
- Comandos de operação são enviados ao CLP somente depois de o adaptador validar os intertravamentos informados pelo CLP.

## Sequência de um saco

```text
KEYENCE SR-X100W → código TCP
sensor do CLP → evento do saco
código associado à passagem → leitura no Dallogix
sem leitura → SEM_LEITURA + JPEG de erro do Keyence → relatório PDF
```

## Configuração

[`register-map.example.json`](./register-map.example.json) é somente um modelo genérico de documentação/simulação; seus endereços físicos `CONFIRMAR` não são o mapa da bancada. Para esta Dala, use exclusivamente o mapa aprovado registrado no README do Node-RED: M2049 (esteira), M2050 (reversão), M2051 (emergência), M17 (retorno da emergência) e M2052 (sensor, lido por FC1). O gateway agora monitora M2052 a cada 200 ms com detecção configurável de borda; ainda é necessária homologação do modo configurado com o Ladder real.

O endereço cadastrado é `192.168.1.10:502`, com Modbus TCP por Ethernet. A escrita física começa desabilitada no instalador e só pode ser habilitada explicitamente depois dos testes de intertravamento. O retorno de movimento da esteira ainda não está configurado; M17 é retorno de emergência e não deve ser reutilizado para indicar movimento.

## Critério de prontidão física

O adaptador só pode ser ligado à esteira depois de validar em bancada:

1. leitura somente dos sinais do CLP;
2. heartbeat do CLP no Dallogix;
3. leitura TCP do Keyence e correlação com cada evento do sensor;
4. ausência de leitura com ocorrência, recebimento da imagem FTP e inclusão no relatório;
5. retorno de movimento separado do comando de saída e do retorno de emergência;
6. comando de desbloqueio com intertravamento e confirmação do CLP;
7. comportamento seguro na perda de comunicação.
