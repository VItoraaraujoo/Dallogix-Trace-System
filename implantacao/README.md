# Implantação do PC industrial

O PC industrial com interface gráfica usa o Trace em modo quiosque: o operador vê somente `http://127.0.0.1:8080` e não acessa a área de trabalho ou outros aplicativos pelo fluxo normal.

## Instalação

1. Copie o projeto para `/opt/dallogix-trace`.
2. Crie o `.env` e valide-o com `bash scripts/check_physical_deployment.sh`. Use `WEB_BIND_ADDRESS=0.0.0.0` para permitir tablets e computadores da rede local; mantenha `BIND_ADDRESS=127.0.0.1` para MySQL, Node-RED e Modbus.
3. Instale o Chromium/Chrome e configure o usuário operador com login automático no ambiente gráfico.
4. Copie os serviços para `/etc/systemd/system/` e habilite:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dallogix-trace.service
sudo systemctl enable --now dallogix-trace-kiosk.service
```

O serviço do Trace sobe os containers; o serviço quiosque abre o navegador em tela cheia e o reinicia se ele fechar. O arquivo de serviço assume um usuário Linux chamado `trace-operator`, sessão gráfica em `DISPLAY=:0` e Xauthority em `/home/trace-operator/.Xauthority`; ajuste esses valores se a distribuição usar outra sessão. A conta administrativa do Linux deve ser separada da conta operador e acessível somente à equipe técnica.

## Manutenção

```bash
sudo systemctl status dallogix-trace.service dallogix-trace-kiosk.service
docker compose ps
docker compose logs --tail=100
```

Não exponha as portas do MySQL, Node-RED ou Modbus fora da rede técnica. A comunicação do CLP real só deve ser habilitada depois da homologação do mapa de I/O.

## Atualizações remotas

As atualizações são assinadas, verificadas por SHA-256, bloqueadas durante qualquer carregamento e protegidas por backup e rollback. Configure os campos `UPDATE_*` no `.env` e siga [documentacao/operacao/atualizacoes-remotas.md](../documentacao/operacao/atualizacoes-remotas.md). O timer deve ser instalado somente pela equipe técnica.
