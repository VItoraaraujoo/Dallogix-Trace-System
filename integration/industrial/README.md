# Adaptador industrial

Esta pasta define o contrato entre o PC industrial, o scanner Elgin EL8600 e o CLP Delta DVP14SS.

## Responsabilidades

- O scanner permanece aberto e em leitura contínua.
- Cada leitura recebida é guardada em buffer com horário e origem.
- O sinal `sack_sensor` do CLP abre uma janela para associar a leitura ao saco.
- Código válido ou incorreto é enviado para `/api/leituras.php`.
- Se a janela expirar sem código, o adaptador envia uma leitura sem `barcode`; o backend dispara a captura de incidente.
- Comandos de operação são enviados ao CLP somente depois de o adaptador validar os intertravamentos informados pelo CLP.

## Sequência de um saco

```text
scanner contínuo → buffer local
sensor do CLP → evento do saco
buffer dentro da janela → leitura no Dallogix
sem leitura → SEM_LEITURA + câmera imediata
```

## Configuração

Use [`register-map.example.json`](./register-map.example.json) como base. Os endereços estão deliberadamente como `CONFIRMAR`: não devem ser escritos no CLP antes da entrega do mapa elétrico e do programa Ladder.

O exemplo usa Modbus RTU sobre RS-485. A Delta documenta leitura/escrita de sinais do DVP por Modbus, mas a variante completa do DVP14SS define a porta, os parâmetros e o cabeamento final.

## Critério de prontidão física

O adaptador só pode ser ligado à esteira depois de validar em bancada:

1. leitura somente dos sinais do CLP;
2. heartbeat do CLP no Dallogix;
3. sensor sem acionamento repetido por debounce;
4. comando de desbloqueio com intertravamento;
5. comportamento seguro na perda de comunicação.
