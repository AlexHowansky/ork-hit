/**
 * The player's view of a session.
 *
 * Two panels, as the spec asks: everyone who has joined, and every active
 * character in initiative order with the player each one belongs to. Both update
 * live — a character the game master adds or removes, a reorder, or a change of
 * turn all arrive over the socket without a refresh.
 *
 * A player who hasn't picked a character yet is asked to choose one first.
 */

import { useState } from "react";
import { api } from "../api.ts";
import { useSessionSocket } from "../useSessionSocket.ts";
import { Button, EmptyState, KindBadge, Panel } from "../components/ui.tsx";
import { InitiativeList } from "../components/InitiativeList.tsx";
import { TurnControls } from "../components/TurnControls.tsx";
import { SheetFrame } from "../components/SheetFrame.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Snapshot } from "../types.ts";

function Notice({ title, body, onLeave }: { title: string; body: string; onLeave: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md rounded-xl border border-stone-200 bg-white p-6 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h1>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{body}</p>
        <Button variant="primary" onClick={onLeave} className="mt-5">
          Back to the start
        </Button>
      </div>
    </div>
  );
}

export function PlayerSession({
  sessionId,
  playerId,
  playerName,
  onLeave,
}: {
  sessionId: string;
  playerId: string;
  playerName: string;
  onLeave: () => void;
}) {
  const toast = useToast();
  const { snapshot, connection, applySnapshot } = useSessionSocket(sessionId);
  const [claiming, setClaiming] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (connection === "ended") {
    return (
      <Notice
        title="The session has ended"
        body="Your game master closed this session. The code will no longer work."
        onLeave={onLeave}
      />
    );
  }

  if (connection === "kicked") {
    return (
      <Notice
        title="You were removed from the session"
        body="Your game master removed you. Ask them for a new code if this was a mistake."
        onLeave={onLeave}
      />
    );
  }

  if (!snapshot) {
    return (
      <p className="p-8 text-center text-stone-500 dark:text-stone-400">Connecting to the table…</p>
    );
  }

  const me = snapshot.players.find((player) => player.id === playerId) ?? null;
  const myCharacterId = me?.claimedCharacterId ?? null;
  const myCharacter =
    snapshot.characters.find((character) => character.id === myCharacterId) ?? null;

  const claim = async (characterId: string) => {
    setClaiming(true);
    try {
      const { snapshot: next } = await api.postJson<{ snapshot: Snapshot }>(
        `/api/sessions/${sessionId}/claim`,
        { characterId },
      );
      applySnapshot(next);
    } catch (error) {
      toast.showError(error);
    } finally {
      setClaiming(false);
    }
  };

  // Before anything else, a player picks which character they're playing.
  if (!myCharacterId) {
    const available = snapshot.characters.filter(
      (character) => character.kind === "pc" && character.claimedByPlayerId === null,
    );

    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Welcome, {playerName}
          </h1>
          <ThemeToggle />
        </header>

        <Panel title="Choose your character">
          {available.length === 0 ? (
            <EmptyState>
              No player characters are free right now. Your game master can add more — this list
              updates on its own.
            </EmptyState>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {available.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  disabled={claiming}
                  onClick={() => void claim(character.id)}
                  className="overflow-hidden rounded-xl border border-stone-200 bg-white text-left shadow-sm transition-shadow hover:shadow-md disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900"
                >
                  <div className="h-28 bg-stone-200 dark:bg-stone-800">
                    {character.backgroundUrl ? (
                      <img
                        src={character.backgroundUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div
                        className="flex h-full items-center justify-center text-3xl opacity-30"
                        aria-hidden
                      >
                        🛡
                      </div>
                    )}
                  </div>
                  <p className="p-3 font-medium text-stone-900 dark:text-stone-100">
                    {character.name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            {myCharacter?.name ?? "Your character"}
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Playing as {playerName}</p>
        </div>
        <div className="flex items-center gap-2">
          {connection === "reconnecting" ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Reconnecting…</span>
          ) : null}
          <ThemeToggle />
          <Button onClick={onLeave}>Leave</Button>
        </div>
      </header>

      <TurnControls
        round={snapshot.session.round}
        activeCharacterName={
          snapshot.characters.find(
            (character) => character.id === snapshot.session.activeCharacterId,
          )?.name ?? null
        }
        editable={false}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Panel title={`Players (${snapshot.players.length})`}>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {snapshot.players.map((player) => {
              const character = snapshot.characters.find(
                (entry) => entry.id === player.claimedCharacterId,
              );
              return (
                <li key={player.id} className="py-2.5">
                  <p className="font-medium text-stone-900 dark:text-stone-100">
                    {player.name}
                    {player.id === playerId ? (
                      <span className="ml-1.5 text-xs font-normal text-stone-500 dark:text-stone-400">
                        (you)
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {character ? `Playing ${character.name}` : "Choosing a character…"}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          title={`In the scene (${snapshot.characters.length})`}
          actions={
            myCharacter ? (
              <Button onClick={() => setSheetOpen(true)}>My sheet</Button>
            ) : null
          }
        >
          {snapshot.characters.length === 0 ? (
            <EmptyState>Your game master hasn't brought anyone into the scene yet.</EmptyState>
          ) : (
            <InitiativeList
              characters={snapshot.characters}
              activeCharacterId={snapshot.session.activeCharacterId}
              yourCharacterId={myCharacterId}
              // Players may open only the sheet of the character they play.
              onOpenSheet={() => setSheetOpen(true)}
              canOpenSheet={(character) => character.id === myCharacterId}
            />
          )}
        </Panel>
      </div>

      {sheetOpen && myCharacter ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${myCharacter.name} character sheet`}
            className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white dark:bg-stone-900"
          >
            <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
              <h2 className="flex items-center gap-2 font-semibold text-stone-900 dark:text-stone-100">
                {myCharacter.name}
                <KindBadge kind={myCharacter.kind} />
              </h2>
              <Button variant="ghost" onClick={() => setSheetOpen(false)} aria-label="Close">
                ✕
              </Button>
            </header>
            <div className="flex-1 p-4">
              <SheetFrame src={myCharacter.sheetUrl} title={myCharacter.name} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
