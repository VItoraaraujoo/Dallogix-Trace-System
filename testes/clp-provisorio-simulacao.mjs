import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fluxo = JSON.parse(readFileSync(path.join(raiz, 'integracoes/node-red/trace-clp-simulador.flow.json'), 'utf8'));
const mapa = JSON.parse(readFileSync(path.join(raiz, 'integracoes/industrial/register-map.example.json'), 'utf8'));
const motor = fluxo.find((no) => no.id === 'sim-engine' && no.type === 'function');

assert.ok(motor, 'motor de simulação Node-RED não encontrado');
const programa = new Script(`(function () {\n${motor.func}\n})()`);

function criarBancada() {
  const memoria = new Map();

  return (acao) => {
    const [evento, estado] = programa.runInNewContext({
      msg: { payload: acao },
      context: {
        get: (chave) => memoria.get(chave),
        set: (chave, valor) => memoria.set(chave, valor),
      },
    }, { timeout: 1000 });

    assert.ok(estado?.payload?.state, `ação ${acao} não retornou estado`);
    return {
      evento: evento?.payload?.event ?? null,
      estado: estado.payload.state,
      progresso: estado.payload.progress,
    };
  };
}

test('mapa físico permanece sem endereços aprovados', () => {
  assert.equal(mapa.plc.plc_ip, 'CONFIRMAR');
  assert.equal(mapa.plc.external_port, 'CONFIRMAR');
  assert.match(mapa.plc.variant, /^CONFIRMAR/);
  for (const [nome, sinal] of Object.entries(mapa.signals)) {
    assert.equal(sinal.address, 'CONFIRMAR', `${nome} não deve ter endereço físico provisório`);
  }
  assert.equal(mapa.simulation.host, '127.0.0.1');
  assert.equal(mapa.simulation.port, 1502);
});

test('iniciar e contar somente durante carregamento', () => {
  const executar = criarBancada();
  assert.equal(executar('RESET').estado.loading_state, 'AGUARDANDO');
  assert.equal(executar('LEITURA_CORRETA').estado.loaded, 0);
  assert.equal(executar('INICIAR').estado.loading_state, 'CARREGANDO');
  const leitura = executar('LEITURA_CORRETA');
  assert.equal(leitura.evento, 'VALIDO');
  assert.equal(leitura.estado.loaded, 1);
  assert.equal(executar('PAUSAR').estado.loading_state, 'PAUSADO');
  assert.equal(executar('LEITURA_CORRETA').estado.loaded, 1);
});

test('produto incorreto e ausência de leitura pausam a simulação', () => {
  for (const [acao, contador] of [
    ['LEITURA_INCORRETA', 'wrong'],
    ['SEM_LEITURA', 'no_read'],
  ]) {
    const executar = criarBancada();
    executar('INICIAR');
    const resultado = executar(acao);
    assert.equal(resultado.evento, acao === 'LEITURA_INCORRETA' ? 'PRODUTO_INCORRETO' : 'SEM_LEITURA');
    assert.equal(resultado.estado.loading_state, 'PAUSADO');
    assert.equal(resultado.estado[contador], 1);
  }
});

test('emergência impede reinício e novas leituras válidas', () => {
  const executar = criarBancada();
  executar('INICIAR');
  executar('LEITURA_CORRETA');
  const emergencia = executar('EMERGENCIA');
  assert.equal(emergencia.estado.emergency, true);
  assert.equal(emergencia.estado.loading_state, 'EMERGENCIA');
  assert.equal(executar('INICIAR').estado.loading_state, 'EMERGENCIA');
  assert.equal(executar('LEITURA_CORRETA').estado.loaded, 1);
});

test('retorno só altera a contagem quando pausado e com saca carregada', () => {
  const executar = criarBancada();
  executar('INICIAR');
  assert.equal(executar('RETORNO').estado.loaded, 0);
  executar('LEITURA_CORRETA');
  executar('PAUSAR');
  const retorno = executar('RETORNO');
  assert.equal(retorno.evento, 'RETORNO');
  assert.equal(retorno.estado.loaded, 0);
  assert.equal(retorno.estado.returns, 1);
  assert.equal(executar('RETORNO').estado.returns, 1);
});

test('quantidade planejada encerra a contagem sem ultrapassar o limite', () => {
  const executar = criarBancada();
  executar('INICIAR');
  let resultado;
  for (let indice = 0; indice < 120; indice += 1) {
    resultado = executar('LEITURA_CORRETA');
  }
  assert.equal(resultado.estado.loaded, 120);
  assert.equal(resultado.estado.loading_state, 'FINALIZANDO');
  assert.equal(resultado.progresso, 100);
  assert.equal(executar('LEITURA_CORRETA').estado.loaded, 120);
});
