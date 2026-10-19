import assert from 'node:assert/strict';
import { criarCarregadorPaginas } from '../interface/js/controladores/carregador-paginas.js';

const calls = [];
let loadingReady = false;
const store = new Proxy({}, {
  get: (_, name) => {
    if (name === 'state') return { selectedLoadingId: null };
    return async () => {
      calls.push(name);
      if (name === 'loadPendingReadings') assert.equal(loadingReady, true);
      if (name === 'loadActiveLoading') {
        await new Promise(resolve => setTimeout(resolve, 5));
        loadingReady = true;
      }
    };
  },
});
let selectedId = null;
const loader = criarCarregadorPaginas({
  store,
  obterPerfil: () => 'ADMIN_EMPRESA',
  obterModoInstalacao: () => 'local',
  idDaConsulta: () => selectedId,
  registrarAviso: () => {},
});
const load = loader.carregarDadosIniciais;

await load('manifests');
assert.deepEqual(calls, ['loadManifests']);
calls.length = 0;
await assert.rejects(load('dala'), /Registro não informado/);
assert.deepEqual(calls, []);
selectedId = '5';
await load('dala');
assert.deepEqual(calls, ['loadEquipment', 'loadDalaCommandHistory', 'loadDalaStatuses']);
calls.length = 0;
await load('work');
assert.equal(calls.includes('loadUsers'), false);
assert.equal(calls.at(-1), 'loadPendingReadings');
console.log('OK: navegação isolada, ID obrigatório e sequência de leituras.');
