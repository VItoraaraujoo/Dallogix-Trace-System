# Teste físico Modbus no CLP — 03/10/2026

## Condição autorizada

O usuário confirmou que o CLP está em bancada sem máquina conectada e autorizou o teste dos coils `2049` e `2050`. O endereço `2051` não foi escrito por software, pois corresponde à emergência física.

## Resultado observado

Foi enviada uma requisição Modbus TCP FC5 para o endereço informado `2049`, com o frame de desligamento:

```text
Requisição: 000100000006010508010000
Resposta:   000100000006010508010000
```

O frame enviado contém o endereço `0x0801` (`2049`), mas a resposta do CLP foi interpretada pelo equipamento como endereço `1` (`0x0001`). O retorno não confirma que `M2049` seja o endereço Modbus correto.

Depois da tentativa, foi feita somente leitura FC1 nos endereços `1`, `2049`, `2050` e `2051`. Todos retornaram valor `0`:

```text
1     -> 00010000000401010100 -> 0
2049  -> 00020000000401010100 -> 0
2050  -> 00030000000401010100 -> 0
2051  -> 00040000000401010100 -> 0
```

## Decisão de segurança

O teste não foi declarado como sucesso para o motor ou reverso. O CLP respondeu a TCP/Modbus, mas o eco do endereço contradiz o mapa informado. Nenhuma nova escrita foi enviada para `2050`, e `2051` permaneceu somente leitura.

Para continuar, é necessário confirmar no manual ou no software do CLP a relação entre `M2049`/`M2050` e o endereço Modbus usado na FC5, incluindo o offset e a unidade. Até essa confirmação, o gateway Trace permanece corretamente bloqueado para escritas físicas.
