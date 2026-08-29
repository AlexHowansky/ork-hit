/** Switches between following the system, forced light, and forced dark. */

import { useState } from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faCircleHalfStroke, faMoon, faSun } from "@fortawesome/free-solid-svg-icons";
import { applyPreference, readPreference, type ThemePreference } from "../theme.ts";
import { Icon } from "./ui.tsx";

const OPTIONS: { value: ThemePreference; label: string; icon: IconDefinition }[] = [
  { value: "light", label: "Light", icon: faSun },
  // Half light, half dark: the choice that is neither, because it is both.
  { value: "system", label: "System", icon: faCircleHalfStroke },
  { value: "dark", label: "Dark", icon: faMoon },
];

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  const choose = (value: ThemePreference) => {
    setPreference(value);
    applyPreference(value);
  };

  return (
    // A `join` rather than daisyUI's `theme-controller`, which is a radio input
    // that writes the attribute itself: this app has three choices for two
    // themes, and the third — following the system — is the absence of the
    // attribute, which `theme-controller` has no way to express.
    <div className="join" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => choose(option.value)}
          aria-pressed={preference === option.value}
          title={`${option.label} theme`}
          className={`btn join-item btn-sm ${preference === option.value ? "btn-active" : ""}`}
        >
          <Icon icon={option.icon} />
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
