/** Small shared primitives, so the pages stay about behaviour rather than classes. */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS = {
  primary:
    "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400",
  secondary:
    "bg-stone-200 text-stone-800 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700",
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-600",
  ghost:
    "text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100",
} as const;

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }) {
  return <button {...props} className={`${BUTTON_BASE} ${VARIANTS[variant]} ${className}`} />;
}

export function Field({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-600"
      />
      {hint ? (
        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{hint}</span>
      ) : null}
    </label>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900 ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">{children}</p>
  );
}

/** Distinguishes a PC from an NPC in lists where both appear. */
export function KindBadge({ kind }: { kind: "pc" | "npc" }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
        kind === "pc"
          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
          : "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
      }`}
    >
      {kind === "pc" ? "PC" : "NPC"}
    </span>
  );
}

/** Copies text and confirms it, for the session code and invite link. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      onClick={async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(value);
          const original = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = original;
          }, 1500);
        } catch {
          // Clipboard access can be refused; select the text so it can be copied
          // by hand rather than failing silently.
          window.prompt("Copy this:", value);
        }
      }}
    >
      {label}
    </Button>
  );
}
