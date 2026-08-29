/**
 * The question asked before something irreversible.
 *
 * This replaces `window.confirm`, which the browser draws in its own chrome: it
 * ignores the theme, the palette and the typeface, and it shows a name in curly
 * quotes in whatever font the browser chrome happens to use. The dialog here is
 * a `Modal` like every other dialog in the app, so it reads the same way in both
 * themes and looks like the page it interrupts.
 *
 * The shape of the call sites is what the promise is for. A guard was one line
 * before and stays one line:
 *
 *     if (!(await confirm({ title: "Delete this?", confirmLabel: "Delete" }))) return;
 *
 * It is a provider rather than something each page mounts because the answer has
 * to outlive the click that asked for it, and a route holding its own `useState`
 * for that would be the same bookkeeping written out four times. `ToastProvider`
 * is the same idea for the same reason.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Button, Modal, TEXT_MUTED } from "./ui.tsx";

interface ConfirmOptions {
  /** The question itself, which is the dialog's heading. */
  title: string;
  /** What the reader may not already know — the consequence beyond the obvious. */
  body?: ReactNode;
  /**
   * The word on the button that goes through with it.
   *
   * Always the verb of the action, never "OK": read on its own, away from the
   * question, it should still say what is about to happen.
   */
  confirmLabel: string;
  /** `danger` for anything that destroys something, which is most of them. */
  tone?: "danger" | "primary";
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return context;
}

/** The open question, and the promise waiting on the answer to it. */
interface Pending {
  options: ConfirmOptions;
  settle: (answer: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // A second question while one is open would otherwise strand the
          // first: nothing can reach its buttons any more, so answer it no.
          current?.settle(false);
          return { options, settle: resolve };
        });
      }),
    [],
  );

  // Every way out goes through here, so no path can clear the dialog while
  // leaving its caller waiting on a promise that never settles.
  const answer = useCallback((value: boolean) => {
    setPending((current) => {
      current?.settle(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? <ConfirmDialog options={pending.options} onAnswer={answer} /> : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Escape and the ✕ are `Modal`'s own, and both land on "no" — the safe answer,
 * and the one the native dialog gave for those same gestures.
 */
function ConfirmDialog({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer: (answer: boolean) => void;
}) {
  return (
    <Modal title={options.title} onClose={() => onAnswer(false)}>
      {options.body ? (
        <p className={`text-sm ${TEXT_MUTED}`}>{options.body}</p>
      ) : null}
      <div className={`modal-action ${options.body ? "mt-5" : "mt-0"}`}>
        <Button type="button" onClick={() => onAnswer(false)}>
          Cancel
        </Button>
        <Button
          type="button"
          // Focused on open, so Enter answers the dialog as it did when the
          // browser drew it. Escape still cancels, so the quick key is not the
          // only key.
          autoFocus
          variant={options.tone ?? "danger"}
          onClick={() => onAnswer(true)}
        >
          {options.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
