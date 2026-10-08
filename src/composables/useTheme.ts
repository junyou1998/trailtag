import { computed, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePreferences, type ThemeMode } from "./usePreferences";

const prefs = usePreferences();
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
media.addEventListener("change", (e) => (systemDark.value = e.matches));

const isDark = computed(() => (prefs.theme === "system" ? systemDark.value : prefs.theme === "dark"));

watch(
  () => prefs.theme,
  (mode) => {
    const root = document.documentElement;
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    if (isTauri()) void getCurrentWindow().setTheme(mode === "system" ? null : mode).catch(() => undefined);
  },
  { immediate: true },
);

const ORDER: ThemeMode[] = ["system", "light", "dark"];

export const THEME_LABEL: Record<ThemeMode, string> = { system: "跟隨系統", light: "淺色", dark: "深色" };

export function useTheme() {
  return {
    mode: computed({ get: () => prefs.theme, set: (v: ThemeMode) => (prefs.theme = v) }),
    isDark,
    cycle: () => (prefs.theme = ORDER[(ORDER.indexOf(prefs.theme) + 1) % ORDER.length]),
  };
}
