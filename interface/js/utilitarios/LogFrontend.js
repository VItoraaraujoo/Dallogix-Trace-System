const LIMITE_REGISTROS = 100;
const INTERVALOS_SUPRESSAO = { aviso: 15000, erro: 5000, info: 0 };
const registros = [];
const ultimosRegistros = new Map();

const CHAVES_SENSIVEIS = /token|senha|password|authorization|cookie|secret|credential|csrf/i;

function valorSeguro(valor, vistos = new WeakSet()) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") return valor;
  if (typeof valor !== "object") return String(valor);
  if (vistos.has(valor)) return "[circular]";
  vistos.add(valor);
  if (Array.isArray(valor)) return valor.slice(0, 20).map((item) => valorSeguro(item, vistos));
  return Object.fromEntries(
    Object.entries(valor).slice(0, 30).map(([chave, item]) => [
      chave,
      CHAVES_SENSIVEIS.test(chave) ? "[omitido]" : valorSeguro(item, vistos),
    ]),
  );
}

function erroSeguro(erro) {
  if (!erro) return null;
  if (typeof erro === "string") return { mensagem: erro };
  return {
    nome: String(erro.name || "Erro"),
    mensagem: String(erro.message || erro),
    ...(erro.code ? { codigo: String(erro.code) } : {}),
    ...(Number.isFinite(Number(erro.status)) ? { status: Number(erro.status) } : {}),
  };
}

/** Registra falhas técnicas sem guardar credenciais ou payloads sensíveis. */
export function registrarLogFrontend(nivel, contexto, erro = null, detalhes = {}, { agora = Date.now() } = {}) {
  const tipo = ["info", "aviso", "erro"].includes(nivel) ? nivel : "erro";
  const chave = `${tipo}:${contexto}:${erroSeguro(erro)?.mensagem || ""}`;
  const intervalo = INTERVALOS_SUPRESSAO[tipo];
  const ultimo = ultimosRegistros.get(chave) || 0;
  if (intervalo > 0 && agora - ultimo < intervalo) return null;
  ultimosRegistros.set(chave, agora);

  const registro = {
    momento: new Date(agora).toISOString(),
    nivel: tipo,
    contexto: String(contexto || "geral"),
    ...(erro ? { erro: erroSeguro(erro) } : {}),
    ...(detalhes && typeof detalhes === "object" ? { detalhes: valorSeguro(detalhes) } : {}),
  };
  registros.push(registro);
  if (registros.length > LIMITE_REGISTROS) registros.shift();

  const metodo = globalThis.console?.[tipo === "aviso" ? "warn" : tipo] || globalThis.console?.log;
  metodo?.call(globalThis.console, `[Trace] ${registro.contexto}`, registro);
  return registro;
}

export const logFrontend = Object.freeze({
  info: (contexto, detalhes = {}) => registrarLogFrontend("info", contexto, null, detalhes),
  aviso: (contexto, erro, detalhes = {}) => registrarLogFrontend("aviso", contexto, erro, detalhes),
  erro: (contexto, erro, detalhes = {}) => registrarLogFrontend("erro", contexto, erro, detalhes),
});

export function listarLogsFrontend() {
  return registros.map((registro) => ({ ...registro }));
}

export function limparLogsFrontend() {
  registros.length = 0;
  ultimosRegistros.clear();
}
