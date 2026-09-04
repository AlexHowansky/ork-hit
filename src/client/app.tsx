/**
 * Routing and the identity gate.
 *
 * Nothing renders until we know who the caller is. A game master lands on their
 * library, a player on their session, and everyone else on the sign-in screen —
 * which is also what a session ending sends a player back to.
 */

import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router";
import { api } from "./api.ts";
import { applyCardSize } from "./cardSize.ts";
import { applyGmSettings } from "./gmSettings.ts";
import { ConfirmProvider } from "./components/Confirm.tsx";
import { LoadingNote } from "./components/ui.tsx";
import { ToastProvider, useToast } from "./components/Toast.tsx";
import { Login } from "./routes/Login.tsx";
import { GmLibrary } from "./routes/GmLibrary.tsx";
import { GmSessionConsole } from "./routes/GmSession.tsx";
import { PlayerSession } from "./routes/PlayerSession.tsx";
import type { Identity } from "./types.ts";

function Shell() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  // One call on boot decides which of the three worlds we're in — and carries a
  // game master's own settings with it, so their card size is on the page before
  // there is a card to draw rather than a moment after.
  useEffect(() => {
    void (async () => {
      try {
        const who = await api.get<Identity>("/api/auth/me");
        if (who.kind === "gm") {
          applyCardSize(who.gm.cardImagePx);
          applyGmSettings(who.gm);
        }
        setIdentity(who);
      } catch {
        setIdentity({ kind: "anonymous" });
      }
    })();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/api/auth/gm/logout");
    } catch (error) {
      toast.showError(error);
    }
    // Back to the defaults: the next person to use this browser is not the one
    // whose eyes the cards were sized for, nor whose library this was.
    applyCardSize(null);
    applyGmSettings(null);
    setIdentity({ kind: "anonymous" });
    navigate("/");
  }, [navigate, toast]);

  const leaveSession = useCallback(async () => {
    try {
      await api.post("/api/auth/player/leave");
    } catch {
      // Leaving is a local action; a failed call shouldn't strand the player.
    }
    setIdentity({ kind: "anonymous" });
    navigate("/");
  }, [navigate]);

  if (!identity) {
    return <LoadingNote>Loading…</LoadingNote>;
  }

  const login = <Login onIdentity={setIdentity} />;

  return (
    <Routes>
      <Route
        path="/"
        element={
          identity.kind === "gm" ? (
            <Navigate to="/gm" replace />
          ) : identity.kind === "player" ? (
            <Navigate to="/play" replace />
          ) : (
            login
          )
        }
      />
      <Route path="/join" element={identity.kind === "player" ? <Navigate to="/play" replace /> : login} />

      <Route
        path="/gm"
        element={
          identity.kind === "gm" ? (
            <GmLibrary email={identity.gm.email} onSignOut={() => void signOut()} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route
        path="/gm/sessions/:id"
        element={
          identity.kind === "gm" ? (
            <GmSessionConsole onSignOut={() => void signOut()} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      <Route
        path="/play"
        element={
          identity.kind === "player" ? (
            <PlayerSession
              sessionId={identity.player.sessionId}
              playerId={identity.player.id}
              playerName={identity.player.name}
              onLeave={() => void leaveSession()}
            />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
