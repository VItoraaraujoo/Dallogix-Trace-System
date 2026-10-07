import assert from "node:assert/strict";
import test from "node:test";
import { createMachineCommandQueue } from "../interface/js/controladores/comandos-maquina.js";

test("comandos opostos do mesmo carregamento são enviados na ordem dos cliques", async () => {
  let liberarInicio;
  let confirmarInicio;
  const inicioPendente = new Promise((resolve) => { liberarInicio = resolve; });
  const inicioEnviado = new Promise((resolve) => { confirmarInicio = resolve; });
  const ordem = [];
  const drenados = [];
  const fila = createMachineCommandQueue({ onDrained: (id) => drenados.push(id) });

  const iniciar = fila.enqueue(42, "INICIAR_CARREGAMENTO", async () => {
    ordem.push("iniciar");
    confirmarInicio();
    await inicioPendente;
  });
  const parar = fila.enqueue(42, "PAUSAR_CARREGAMENTO", async () => {
    ordem.push("parar");
  });
  await inicioEnviado;
  assert.deepEqual([...ordem], ["iniciar"]);

  liberarInicio();
  await Promise.all([iniciar, parar]);
  assert.deepEqual([...ordem], ["iniciar", "parar"]);
  assert.deepEqual(drenados, [42]);
});

test("clique duplicado do mesmo comando não gera envio repetido", async () => {
  let liberarComando;
  const comandoPendente = new Promise((resolve) => { liberarComando = resolve; });
  let envios = 0;
  const fila = createMachineCommandQueue();
  const executar = async () => {
    envios += 1;
    await comandoPendente;
  };
  const primeiro = fila.enqueue(8, "REVERSAO_ATIVAR", executar);
  const duplicado = await fila.enqueue(8, "REVERSAO_ATIVAR", executar);
  assert.equal(duplicado, null);
  assert.equal(envios, 0);
  await Promise.resolve();
  assert.equal(envios, 1);
  liberarComando();
  await primeiro;
  assert.equal(envios, 1);
});

test("comandos de Dalas diferentes não ficam presos na mesma fila", async () => {
  let liberarPrimeiro;
  const primeiroPendente = new Promise((resolve) => { liberarPrimeiro = resolve; });
  const ids = [];
  const fila = createMachineCommandQueue();
  const primeiro = fila.enqueue(1, "INICIAR_CARREGAMENTO", async () => {
    ids.push(1);
    await primeiroPendente;
  });
  const segundo = fila.enqueue(2, "INICIAR_CARREGAMENTO", async () => ids.push(2));
  await segundo;
  assert.deepEqual(ids, [1, 2]);
  liberarPrimeiro();
  await primeiro;
});
