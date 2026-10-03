# Teste físico Modbus no CLP — 03/10/2026

## Condição autorizada

O usuário confirmou que o CLP está em bancada sem máquina conectada e autorizou o teste dos coils `2049` e `2050`. O endereço `2051` não foi escrito por software, pois corresponde à emergência física.

## Resultado observado

O teste usou Modbus TCP FC5 para escrever cada coil e FC1 para ler o retorno. O parser foi corrigido para interpretar os bytes do frame completo; os frames retornados pelo CLP confirmaram os endereços `0x0801` (`2049`) e `0x0802` (`2050`).

| Endereço | Leitura inicial | FC5 ON | Leitura após ON | FC5 OFF | Leitura após OFF |
| --- | ---: | --- | ---: | --- | ---: |
| `2049` / `M2049` | `0` | `00020000000601050801FF00` | `1` (`00030000000401010101`) | `000400000006010508010000` | `0` (`00050000000401010100`) |
| `2050` / `M2050` | `0` | `00070000000601050802FF00` | `1` (`00080000000401010101`) | `000900000006010508020000` | `0` (`000A0000000401010100`) |

## Decisão de segurança

As duas saídas testadas responderam ao endereço correto e retornaram ao estado `0` após o teste. O endereço `2051` não foi escrito por software; a emergência continua exclusivamente física.

O gateway Trace ainda mantém a escrita física bloqueada no fluxo de produção até que esse mapa e os intertravamentos sejam formalmente incorporados ao adaptador industrial. O teste direto comprovou o transporte Modbus e as saídas da bancada, sem declarar que o botão de emergência pode ser substituído pelo software.
