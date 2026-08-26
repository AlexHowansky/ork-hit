/**
 * The front door.
 *
 * Both audiences arrive here: a game master signs in with email and password, a
 * player redeems a session code. Nothing else in the app is reachable without
 * one of the two.
 */

import { useState } from "react";
import { faDiceD20 } from "@fortawesome/free-solid-svg-icons";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api.ts";
import {
  Button,
  Field,
  HAIRLINE,
  Icon,
  SURFACE,
  TEXT_STRONG,
} from "../components/ui.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Identity, Snapshot } from "../types.ts";

type Tab = "player" | "gm";

export function Login({ onIdentity }: { onIdentity: (identity: Identity) => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();

  // A join link carries the code, so arriving from one lands on the right tab
  // with the field already filled in.
  const codeFromLink = params.get("code") ?? "";
  const [tab, setTab] = useState<Tab>("player");

  const [code, setCode] = useState(codeFromLink);
  const [playerName, setPlayerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const joinSession = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.postJson<{
        player: { id: string; name: string; sessionId: string };
        snapshot: Snapshot;
      }>("/api/sessions/join", { code, name: playerName });

      onIdentity({
        kind: "player",
        player: {
          id: result.player.id,
          name: result.player.name,
          sessionId: result.player.sessionId,
          claimedCharacterId: null,
        },
      });
      navigate("/play");
    } catch (error) {
      toast.showError(error);
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api.postJson<{ gm: { id: string; email: string } }>(
        "/api/auth/gm/login",
        { email, password },
      );
      onIdentity({ kind: "gm", gm: result.gm });
      navigate("/gm");
    } catch (error) {
      toast.showError(error);
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className={`text-xl font-semibold ${TEXT_STRONG}`}>
            <Icon icon={faDiceD20} className="h-5 w-5" /> TTRPG Synchronizer
          </h1>
          <ThemeToggle />
        </div>

        <div className={`${SURFACE} shadow-sm`}>
          <div className={`grid grid-cols-2 border-b ${HAIRLINE}`} role="tablist">
            {(["player", "gm"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`px-4 py-3 text-sm font-medium transition-colors ${
                  tab === value
                    ? `border-b-2 border-amber-500 ${TEXT_STRONG}`
                    : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                }`}
              >
                {value === "player" ? "Join a session" : "Game master"}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "player" ? (
              <form onSubmit={joinSession} className="space-y-4">
                <Field
                  label="Session code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  className="font-mono"
                  hint="Your game master will send you this."
                />
                <Field
                  label="Player name"
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="What should everyone call you?"
                  autoComplete="nickname"
                  required
                  hint={
                    <>
                      This is <em>your</em> name. You will select a character after logging in.
                    </>
                  }
                />
                <Button variant="primary" type="submit" disabled={busy} className="w-full">
                  {busy ? "Joining…" : "Join session"}
                </Button>
              </form>
            ) : (
              <form onSubmit={signIn} className="space-y-4">
                <Field
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                  required
                />
                <Field
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <Button variant="primary" type="submit" disabled={busy} className="w-full">
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
