import { DomainError } from './errors.js';

/**
 * Data de calendário em UTC no formato YYYY-MM-DD.
 *
 * Billing de nuvem é sempre fechado por dia em UTC (AWS CUR e Azure Cost Management),
 * então o domínio inteiro trabalha com datas sem horário para evitar bugs de fuso.
 */
export type IsoDate = string;
/** Mês no formato YYYY-MM. */
export type IsoMonth = string;

export interface Period {
  /** Início, inclusivo. */
  from: IsoDate;
  /** Fim, inclusivo. */
  to: IsoDate;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isIsoMonth(value: string): boolean {
  const match = ISO_MONTH.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function assertIsoDate(value: string, field = 'data'): IsoDate {
  if (!isIsoDate(value)) throw new DomainError(`${field} inválida: "${value}" (esperado YYYY-MM-DD)`, 'INVALID_DATE');
  return value;
}

function toUtc(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * MS_PER_DAY);
}

/** Quantidade de dias de `from` até `to` (negativo se `to` for anterior). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

/** Todas as datas do período, inclusivo nas duas pontas. */
export function dateRange(period: Period): IsoDate[] {
  const total = daysBetween(period.from, period.to);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, i) => addDays(period.from, i));
}

export function periodLength(period: Period): number {
  return Math.max(0, daysBetween(period.from, period.to) + 1);
}

/** 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7);
}

export function monthPeriod(month: IsoMonth): Period {
  if (!isIsoMonth(month)) throw new DomainError(`mês inválido: "${month}" (esperado YYYY-MM)`, 'INVALID_MONTH');
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export function previousPeriod(period: Period): Period {
  const length = periodLength(period);
  return { from: addDays(period.from, -length), to: addDays(period.from, -1) };
}

export function inPeriod(date: IsoDate, period: Period): boolean {
  return date >= period.from && date <= period.to;
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * Normaliza os formatos de data que aparecem nos exports de billing para YYYY-MM-DD (UTC).
 *
 * - ISO 8601 com ou sem horário/offset (AWS CUR, FOCUS): `2026-11-01T00:00:00Z`, `2026-11-01 00:00:00`
 * - Formato americano MM/DD/YYYY (exports do Azure Cost Management)
 * - Compacto YYYYMMDD (API Query do Azure)
 *
 * Timestamps com offset são convertidos para UTC antes de truncar, porque o dia de cobrança é UTC.
 */
export function normalizeDate(raw: string): IsoDate | null {
  const value = raw.trim();
  if (value === '') return null;

  if (isIsoDate(value)) return value;

  const compact = COMPACT_DATE.exec(value);
  if (compact) {
    const candidate = `${compact[1]}-${compact[2]}-${compact[3]}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  const us = US_DATE.exec(value);
  if (us) {
    const candidate = `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
    return isIsoDate(candidate) ? candidate : null;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(value)) {
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const iso = value.replace(' ', 'T') + (hasZone ? '' : 'Z');
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : fromUtc(ms);
  }

  return null;
}
