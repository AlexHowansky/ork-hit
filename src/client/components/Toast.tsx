/**
 * Transient messages.
 *
 * Errors surfaced here are the user-facing messages the API already produced, so
 * they can be shown verbatim.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastTone = "error" | "success" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  show: (message: string, tone?: ToastTone) => void;
  /** Shows the message from a thrown error, falling back to a generic line. */
  showError: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
    },
    [dismiss],
  );

  const showError = useCallback(
    (error: unknown) => {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong. Please try again.";
      show(message, "error");
    },
    [show],
  );

  const api = useMemo(() => ({ show, showError }), [show, showError]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[1000] flex flex-col items-center gap-2 p-4"
        // Announced to assistive technology without stealing focus.
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => dismiss(toast.id)}
            className={`alert pointer-events-auto block max-w-xl px-6 py-4 text-left text-base font-medium shadow-xl ${
              toast.tone === "error"
                ? "alert-error"
                : toast.tone === "success"
                  ? "alert-success"
                  : "alert-info"
            }`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
