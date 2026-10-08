import { reactive, watch } from "vue";
import { systemOffsetAt } from "../core/time";
import type { MatchSettings } from "../core/types";

export type ThemeMode = "system" | "light" | "dark";

export interface Preferences {
  theme: ThemeMode;
  defaultOffsetMin: number;
  match: MatchSettings;
  overwriteExisting: boolean;
  backup: boolean;
  writeOffset: boolean;
}

const KEY = "trailtag:preferences";

export const DEFAULT_MATCH: MatchSettings = {
  maxGapSec: 300,
  stationaryGapSec: 3600,
  stationaryRadiusM: 150,
  maxExtrapSec: 120,
};

function defaults(): Preferences {
  return {
    theme: "system",
    defaultOffsetMin: systemOffsetAt(Date.now()),
    match: { ...DEFAULT_MATCH },
    overwriteExisting: false,
    backup: true,
    writeOffset: false,
  };
}

function load(): Preferences {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Preferences>;
    return { ...base, ...saved, match: { ...base.match, ...saved.match } };
  } catch {
    return base;
  }
}

const preferences = reactive<Preferences>(load());

watch(
  preferences,
  (value) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      return;
    }
  },
  { deep: true },
);

export function usePreferences(): Preferences {
  return preferences;
}
