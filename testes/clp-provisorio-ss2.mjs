import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arquivo = path.join(raiz, 'integracoes/industrial/clp-provisorio-ss2.il');
const entradas = ['M10', 'M11', 'M12', 'M13', 'M14', 'M20'];
const saidas = ['M100', 'M101', 'M102', 'M103', 'M104'];
const instrucoes = readFileSync(arquivo, 'utf8')
  .split(/\r?\n/)
  .map((linha) => linha.trim())
  .filter(Boolean)
  .map((linha) => {
    const match = /^(LD|AND|ANI|OR|OUT|END)(?: (M\d+))?$/.exec(linha);
    assert.ok(match, `instrução IL fora do subconjunto de teste: ${linha}`);
    return { operacao: match[1], dispositivo: match[2] };
  });

function varrer(estadoInicial) {
  const memoria = new Map([...entradas, ...saidas].map((nome) => [nome, Boolean(estadoInicial[nome])]));
  let acumulador = false;

  for (const { operacao, dispositivo } of instrucoes) {
    const contato = memoria.get(dispositivo) === true;
    switch (operacao) {
      case 'LD': acumulador = contato; break;
      case 'AND': acumulador = acumulador && contato; break;
      case 'ANI': acumulador = acumulador && !contato; break;
      case 'OR': acumulador = acumulador || contato; break;
      case 'OUT': memoria.set(dispositivo, acumulador); break;
      case 'END': return Object.fromEntries(saidas.map((nome) => [nome, memoria.get(nome)]));
      default: throw new Error(`operação desconhecida: ${operacao}`);
    }
  }
  throw new Error('programa sem END');
}

test('fonte IL usa somente bits internos e encerra com END', () => {
  assert.equal(instrucoes.at(-1).operacao, 'END');
  assert.equal(instrucoes.filter(({ operacao }) => operacao === 'END').length, 1);
  assert.equal(instrucoes.at(-1).dispositivo, undefined);

  const lidos = new Set();
  const escritos = new Set();
  for (const { operacao, dispositivo } of instrucoes.slice(0, -1)) {
    assert.ok(dispositivo, `${operacao} exige operando`);
    if (operacao === 'OUT') {
      assert.ok(saidas.includes(dispositivo), `saída de teste inesperada: ${dispositivo}`);
      escritos.add(dispositivo);
    } else {
      assert.ok(entradas.includes(dispositivo), `entrada de teste inesperada: ${dispositivo}`);
      lidos.add(dispositivo);
    }
  }
  assert.deepEqual([...lidos].sort(), [...entradas].sort());
  assert.deepEqual([...escritos].sort(), [...saidas].sort());
});

test('as 64 combinações de entrada obedecem ao contrato provisório', () => {
  for (let combinacao = 0; combinacao < 2 ** entradas.length; combinacao += 1) {
    const estado = Object.fromEntries(entradas.map((nome, indice) => [nome, Boolean(combinacao & (1 << indice))]));
    const resultado = varrer(estado);
    assert.equal(resultado.M100, estado.M10 && !estado.M11 && !estado.M12 && !estado.M13 && estado.M14);
    assert.equal(resultado.M101, estado.M20 && estado.M11 && !estado.M12 && !estado.M13 && estado.M14);
    assert.equal(resultado.M102, estado.M10 && estado.M12);
    assert.equal(resultado.M103, estado.M20 && !estado.M11);
    assert.equal(resultado.M104, (estado.M10 || estado.M20) && !estado.M14);
    assert.equal(resultado.M100 && resultado.M101, false, 'partida e reversão não podem ser autorizadas juntas');
    if (estado.M12 || estado.M13 || !estado.M14) {
      assert.equal(resultado.M100 || resultado.M101, false, 'intertravamento deve bloquear as duas autorizações');
    }
  }
});
