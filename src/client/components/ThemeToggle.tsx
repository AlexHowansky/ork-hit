/** Switches between following the system, forced light, and forced dark. */

import { useState } from "react";
import { applyPreference, readPreference, type ThemePreference } from "../theme.ts";

const OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀" },
  { value: "system", label: "System", icon: "◐" },
  { value: "dark", label: "Dark", icon: "☾" },
];

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  const choose = (value: ThemePreference) => {
    setPreference(value);
    applyPreference(value);
  };

  return (
    <div
      className="inline-flex rounded-lg bg-stone-200 p-0.5 dark:bg-stone-800"
      role="group"
      aria-label="Colour theme"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => choose(option.value)}
          aria-pressed={preference === option.value}
          title={`${option.label} theme`}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
            preference === option.value
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-600 dark:text-stone-50"
              : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          }`}
        >
          <span aria-hidden="true">{option.icon}</span>
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
