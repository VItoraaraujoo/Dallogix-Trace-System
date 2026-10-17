# Integração industrial

Esta pasta descreve o contrato entre o PC industrial, o scanner Elgin EL8600 e o CLP INVT TS621 informado para a bancada. O mapa aprovado e os endereços usados pelo gateway estão documentados em [`integracoes/node-red/README.md`](../node-red/README.md).

## Responsabilidades

- O único modelo previsto para produção é o Elgin EL8600 por USB HID (teclado). A tela de Operação recupera o foco do campo de leitura depois de toques fora de campos e quando a janela volta ao primeiro plano.
- Configure o scanner para enviar Enter ao final do código. O navegador recebe as teclas como um teclado comum; por isso, o Trace confirma uma leitura recebida, mas não consegue verificar a conexão USB enquanto o leitor está ocioso.
- O leitor USB genérico usado para testes de leitura não substitui a homologação do Elgin EL8600 no PC industrial.
- Cada leitura é enviada pelo formulário da tela; ainda falta associá-la ao evento de passagem do sensor do CLP.
- O sinal `sack_sensor` do CLP deve abrir a janela para associar a leitura ao saco; o fluxo Node-RED publicado ainda não emite esse evento.
- Código válido ou incorreto é enviado para `/api/leituras.php`.
- Se a janela expirar sem código, o adaptador envia uma leitura sem `barcode`; o servidor registra `SEM_LEITURA`, solicita a captura de incidente e mantém o carregamento em andamento, sem pedir pausa automática.
- Comandos de operação são enviados ao CLP somente depois de o adaptador validar os intertravamentos informados pelo CLP.

## Sequência de um saco

```text
scanner contínuo → buffer local
sensor do CLP → evento do saco
buffer dentro da janela → leitura no Dallogix
sem leitura → SEM_LEITURA + captura da câmera, sem pausar o carregamento
```

## Configuração

[`register-map.example.json`](./register-map.example.json) é somente um modelo genérico de documentação/simulação; seus endereços físicos `CONFIRMAR` não são o mapa da bancada. Para esta Dala, use exclusivamente o mapa aprovado registrado no README do Node-RED: M2049 (esteira), M2050 (reversão), M2051 (emergência), M17 (retorno da emergência) e M2052 (bit do sensor, lido por FC1). O Ladder ainda precisa confirmar se o sinal é pulso ou nível mantido antes da correlação automática de sacos.

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
