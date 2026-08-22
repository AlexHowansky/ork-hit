/**
 * Colour theme preference.
 *
 * Three states: follow the system, force light, force dark. "System" is the
 * default and is handled entirely in CSS, so a reader who never touches the
 * toggle gets a correct first paint with no script involved. An explicit choice
 * is written to <html data-theme> and remembered in localStorage.
 */

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "ttrpg.theme";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    // Private browsing and blocked site data both throw here.
    return "system";
  }
}

export function applyPreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);

  try {
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A preference we cannot persist still applies for this page view.
  }
}

/** Applied before React renders, so a stored choice doesn't flash the other theme. */
export function initTheme(): void {
  const preference = readPreference();
  if (preference !== "system") document.documentElement.setAttribute("data-theme", preference);
}
