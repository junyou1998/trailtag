const CAMERA_TIME = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

export function parseCameraTime(value: string | null, subSec?: string | null): number | null {
  if (!value) return null;
  const m = CAMERA_TIME.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const ms = subSec && /^\d+$/.test(subSec) ? Math.round(Number(`0.${subSec}`) * 1000) : 0;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  return Number.isNaN(t) ? null : t;
}

export function parseOffset(value: string | null): number | null {
  if (!value) return null;
  const m = OFFSET.exec(value.trim());
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

export function systemOffsetAt(naiveMs: number): number {
  return -new Date(naiveMs).getTimezoneOffset();
}

export function toUtc(naiveMs: number, offsetMin: number, adjustSec = 0): number {
  return naiveMs - offsetMin * 60_000 + adjustSec * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatNaive(ms: number, withDate = true): string {
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  if (!withDate) return time;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}`;
}

export function formatUtc(ms: number, withDate = true): string {
  return `${formatNaive(ms, withDate)}Z`;
}

export function formatAtOffset(utcMs: number, offsetMin: number, withDate = true): string {
  return formatNaive(utcMs + offsetMin * 60_000, withDate);
}

export function formatDuration(sec: number): string {
  const s = Math.round(Math.abs(sec));
  if (s < 60) return `${s} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
  return `${Math.floor(s / 3600)} 小時 ${Math.round((s % 3600) / 60)} 分`;
}
