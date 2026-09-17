import { agora } from "./relogio.js?v=202609170015";

const dateOnly = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const numberFormat = new Intl.NumberFormat("pt-BR");

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const normalized = String(value).trim().replace(" ", "T");
  // Datas de calendário não representam um instante UTC. Construí-las com
  // `new Date("AAAA-MM-DD")` desloca a exibição para o dia anterior em fusos
  // como o de Brasília. Mantemos a data no fuso local para romaneios,
  // relatórios e filtros operacionais.
  const dateOnlyMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const localDate = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function data(value, fallback = "—") {
  const parsed = parseDate(value);
  return parsed ? dateOnly.format(parsed) : fallback;
}

export function dataHora(value, fallback = "—") {
  const parsed = parseDate(value);
  return parsed ? dateTime.format(parsed) : fallback;
}

export function numero(value, fallback = "0") {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? numberFormat.format(parsed) : fallback;
}

export function relativo(value, fallback = "Sem sinal") {
  const parsed = parseDate(value);
  if (!parsed) return fallback;
  const seconds = Math.max(0, Math.floor((agora().getTime() - parsed.getTime()) / 1000));
  if (seconds < 60) return `há ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}
