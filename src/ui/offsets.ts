import { formatOffset } from "../core/time";
import { CANDIDATE_OFFSETS } from "../core/timezone";

const NAMES: Record<number, string> = {
  [-600]: "夏威夷",
  [-480]: "美西（冬令）",
  [-420]: "美西（夏令）",
  [-360]: "美中（冬令）",
  [-300]: "美東（冬令）",
  [-240]: "美東（夏令）",
  [-180]: "巴西",
  0: "英國（冬令）",
  60: "歐洲中部（冬令）／英國（夏令）",
  120: "歐洲中部（夏令）",
  180: "土耳其／莫斯科",
  240: "杜拜",
  330: "印度",
  345: "尼泊爾",
  420: "泰國／越南／印尼西部",
  480: "台灣／中國／香港／新加坡",
  540: "日本／韓國",
  570: "澳洲中部（冬令）",
  600: "澳洲東部（冬令）",
  660: "澳洲東部（夏令）",
  720: "紐西蘭（冬令）",
  780: "紐西蘭（夏令）",
};

export interface OffsetOption {
  value: number;
  label: string;
}

export function offsetLabel(minutes: number): string {
  const name = NAMES[minutes];
  return `UTC${formatOffset(minutes)}${name ? `　${name}` : ""}`;
}

export const OFFSET_OPTIONS: OffsetOption[] = CANDIDATE_OFFSETS.filter((m) => m % 60 === 0 || NAMES[m]).map((value) => ({
  value,
  label: offsetLabel(value),
}));

export function shortOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+";
  const abs = Math.abs(minutes);
  return abs % 60 ? `${sign}${formatOffset(abs).slice(1)}` : `${sign}${abs / 60}`;
}
