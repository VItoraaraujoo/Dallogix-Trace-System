# Integração industrial

Esta pasta descreve o contrato entre o PC industrial, os leitores de código e o CLP INVT TS621 informado para a bancada. O mapa aprovado e os endereços usados pelo gateway estão documentados em [`integracoes/node-red/README.md`](../node-red/README.md).

A integração opcional do KEYENCE SR-X100W está implementada em [`documentacao/operacao/preparacao-keyence-sr-x100w.md`](../../documentacao/operacao/preparacao-keyence-sr-x100w.md). O Elgin EL8600 continua como leitor de produção até a configuração física e a homologação do Keyence passarem.

## Responsabilidades

- O Elgin EL8600 permanece como leitor de produção por USB HID (teclado). A tela de Operação recupera o foco do campo de leitura depois de toques fora de campos e quando a janela volta ao primeiro plano.
- Configure o scanner para enviar Enter ao final do código. O navegador recebe as teclas como um teclado comum; por isso, o Trace confirma uma leitura recebida, mas não consegue verificar a conexão USB enquanto o leitor está ocioso.
- O leitor USB genérico usado para testes de leitura não substitui a homologação do Elgin EL8600 no PC industrial.
- O resultado do Keyence chega diretamente ao PC por TCP e é enviado à mesma classificação de produto por `/api/leituras.php`, autenticado como `SCANNER` da Dala vinculada.
- O Node-RED monitora M2052 e publica eventos de passagem. O servidor associa a leitura ao evento pendente mais recente dentro da janela configurada.
- Se a janela expirar sem código, o servidor registra `SEM_LEITURA` e solicita evidência. O SR-X100W pode enviar um JPEG por FTP; se não houver foto compatível sem ambiguidade, a câmera Hikvision é acionada após a espera configurada.
- Comandos de operação são enviados ao CLP somente depois de o adaptador validar os intertravamentos informados pelo CLP.

## Sequência de um saco

```text
scanner contínuo → buffer local
sensor do CLP → evento do saco
buffer dentro da janela → leitura no Dallogix
sem leitura → SEM_LEITURA + captura da câmera, sem pausar o carregamento
```

## Configuração

[`register-map.example.json`](./register-map.example.json) é somente um modelo genérico de documentação/simulação; seus endereços físicos `CONFIRMAR` não são o mapa da bancada. Para esta Dala, use exclusivamente o mapa aprovado registrado no README do Node-RED: M2049 (esteira), M2050 (reversão), M2051 (emergência), M17 (retorno da emergência) e M2052 (sensor, lido por FC1). O gateway agora monitora M2052 a cada 200 ms com detecção configurável de borda; ainda é necessária homologação do modo configurado com o Ladder real.

O endereço cadastrado é `192.168.1.10:502`, com Modbus TCP por Ethernet. A escrita física começa desabilitada no instalador e só pode ser habilitada explicitamente depois dos testes de intertravamento. O retorno de movimento da esteira ainda não está configurado; M17 é retorno de emergência e não deve ser reutilizado para indicar movimento.

## Critério de prontidão física

O adaptador só pode ser ligado à esteira depois de validar em bancada:

1. leitura somente dos sinais do CLP;
2. heartbeat do CLP no Dallogix;
3. leitura USB HID com Enter/sufixo e correlação com cada evento do sensor;
4. ausência de leitura com ocorrência e captura da câmera, sem pausar o carregamento;
5. retorno de movimento separado do comando de saída e do retorno de emergência;
6. comando de desbloqueio com intertravamento e confirmação do CLP;
7. comportamento seguro na perda de comunicação.
