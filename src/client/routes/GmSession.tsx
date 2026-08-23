/**
 * The game master's session console.
 *
 * Everything that changes what players see happens here: which characters are
 * active, what order they act in, whose turn it is, and who is in the room.
 * Every mutation returns the new snapshot, which is applied straight away, and
 * the same snapshot is broadcast to the players.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api.ts";
import { useSessionSocket } from "../useSessionSocket.ts";
import {
  AppPage,
  Button,
  CharacterThumb,
  CopyButton,
  EmptyState,
  KindBadge,
  Panel,
} from "../components/ui.tsx";
import { InitiativeList } from "../components/InitiativeList.tsx";
import { TurnControls } from "../components/TurnControls.tsx";
import { SheetOverlay } from "../components/SheetFrame.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Character, GameSession, SessionCharacter, Snapshot } from "../types.ts";

export function GmSessionConsole() {
  const { id: sessionId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const { snapshot, connection, applySnapshot } = useSessionSocket(sessionId);
  const [session, setSession] = useState<GameSession | null>(null);
  const [library, setLibrary] = useState<Character[]>([]);
  const [viewingSheet, setViewingSheet] = useState<SessionCharacter | null>(null);
  const [busy, setBusy] = useState(false);

  // Loaded once: the code and the campaign don't change while a session runs.
  useEffect(() => {
    void (async () => {
      try {
        const { sessions } = await api.get<{ sessions: GameSession[] }>("/api/sessions");
        const found = sessions.find((entry) => entry.id === sessionId) ?? null;
        setSession(found);
        if (found) {
          const { characters } = await api.get<{ characters: Character[] }>(
            `/api/characters?campaignId=${encodeURIComponent(found.campaignId)}`,
          );
          setLibrary(characters);
        }
      } catch (error) {
        toast.showError(error);
      }
    })();
  }, [sessionId, toast]);

  /** Runs a mutation and applies the snapshot it returns. */
  const mutate = useCallback(
    async (action: () => Promise<{ snapshot: Snapshot }>) => {
      setBusy(true);
      try {
        const { snapshot: next } = await action();
        applySnapshot(next);
      } catch (error) {
        toast.showError(error);
      } finally {
        setBusy(false);
      }
    },
    [applySnapshot, toast],
  );

  const addCharacter = (characterId: string) =>
    mutate(() =>
      api.post<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/characters/${characterId}`),
    );

  const removeCharacter = (characterId: string) =>
    mutate(() =>
      api.delete<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/characters/${characterId}`),
    );

  const setTurn = (characterId: string) =>
    mutate(() => api.postJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/turn`, {
      characterId,
    }));

  const advanceTurn = useCallback(
    (direction: "next" | "prev") =>
      void mutate(() =>
        api.postJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/turn/advance`, {
          direction,
        }),
      ),
    [mutate, sessionId],
  );

  const reorder = (orderedIds: string[]) => {
    // Apply the drop immediately so the list doesn't snap back under the cursor;
    // if the write is rejected, the broadcast snapshot restores the real order.
    if (snapshot) {
      const byId = new Map(snapshot.characters.map((character) => [character.id, character]));
      applySnapshot({
        ...snapshot,
        characters: orderedIds.flatMap((id, index) => {
          const character = byId.get(id);
          return character ? [{ ...character, position: index }] : [];
        }),
      });
    }
    void mutate(() =>
      api.putJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/order`, {
        order: orderedIds,
      }),
    );
  };

  const setClaim = (playerId: string, claimedCharacterId: string | null) =>
    mutate(() =>
      api.patchJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/players/${playerId}`, {
        claimedCharacterId,
      }),
    );

  const kickPlayer = (playerId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this session?`)) return;
    void mutate(() =>
      api.delete<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/players/${playerId}`),
    );
  };

  const endSession = async () => {
    if (
      !window.confirm("End this session? The code stops working and everyone is disconnected.")
    ) {
      return;
    }
    try {
      await api.post(`/api/sessions/${sessionId}/end`);
      toast.show("Session ended.", "success");
      navigate("/gm");
    } catch (error) {
      toast.showError(error);
    }
  };

  if (!session) {
    return <p className="p-8 text-center text-stone-500 dark:text-stone-400">Loading session…</p>;
  }

  const activeIds = new Set(snapshot?.characters.map((character) => character.id) ?? []);
  const availableCharacters = library.filter((character) => !activeIds.has(character.id));
  const activeCharacter =
    snapshot?.characters.find(
      (character) => character.id === snapshot.session.activeCharacterId,
    ) ?? null;
  const playerCharacters = snapshot?.characters.filter((c) => c.kind === "pc") ?? [];

  const joinUrl = `${location.origin}/join?code=${encodeURIComponent(session.code)}`;

  // Three static controls. On a tall screen they get their own panel; on a wide
  // one that band of height is worth more to the lists below, so they ride along
  // in the header instead.
  const invite = (
    <div className="flex flex-wrap items-center gap-3">
      <code className="rounded-lg bg-stone-100 px-3 py-2 font-mono text-sm tracking-wider text-stone-900 dark:bg-stone-800 dark:text-stone-100">
        {session.code}
      </code>
      <CopyButton value={session.code} label="Copy code" />
      <CopyButton value={joinUrl} label="Copy join link" />
    </div>
  );

  return (
    <AppPage>
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" onClick={() => navigate("/gm")} className="mb-1 -ml-2">
            ← Library
          </Button>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            {session.campaignName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden wide:block">{invite}</div>
          {connection === "reconnecting" ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Reconnecting…</span>
          ) : null}
          <ThemeToggle />
          <Button variant="danger" onClick={() => void endSession()}>
            End session
          </Button>
        </div>
      </header>

      <Panel title="Invite" className="wide:hidden">
        {invite}
      </Panel>

      <TurnControls
        className="shrink-0"
        round={snapshot?.session.round ?? session.round}
        activeCharacterName={activeCharacter?.name ?? null}
        editable
        onAdvance={advanceTurn}
        disabled={busy || (snapshot?.characters.length ?? 0) === 0}
      />

      <div className="grid gap-5 lg:grid-cols-2 wide:min-h-0 wide:flex-1 wide:grid-cols-3">
        <Panel
          title={`Initiative order (${snapshot?.characters.length ?? 0})`}
          scroll
          className="wide:order-1"
        >
          {snapshot && snapshot.characters.length > 0 ? (
            <>
              <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
                Drag to reorder. Use the arrow keys to move the turn marker.
              </p>
              <InitiativeList
                characters={snapshot.characters}
                activeCharacterId={snapshot.session.activeCharacterId}
                editable
                onReorder={reorder}
                onSetTurn={(id) => void setTurn(id)}
                onRemove={(id) => void removeCharacter(id)}
                onOpenSheet={setViewingSheet}
              />
            </>
          ) : (
            <EmptyState>
              No characters in the session yet. Add some from the library.
            </EmptyState>
          )}
        </Panel>

        {/*
          Stacked, these read in the order they are written: who is here, then who
          could be added. Side by side, the library belongs next to the initiative
          order it feeds, so the three columns are ordered rather than rewritten —
          reading order is only out of step with the columns on a wide screen, and
          only for these two.
        */}
        <div className="space-y-5 wide:contents">
          <Panel
            title={`Players (${snapshot?.players.length ?? 0})`}
            scroll
            className="wide:order-3"
          >
            {snapshot && snapshot.players.length > 0 ? (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {snapshot.players.map((player) => {
                  const claimed = snapshot.characters.find(
                    (character) => character.id === player.claimedCharacterId,
                  );
                  return (
                    <li key={player.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-stone-900 dark:text-stone-100">
                          {player.name}
                        </p>
                        <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                          {claimed ? `Playing ${claimed.name}` : "No character chosen yet"}
                        </p>
                      </div>
                      <select
                        value={player.claimedCharacterId ?? ""}
                        onChange={(event) =>
                          void setClaim(player.id, event.target.value || null)
                        }
                        aria-label={`Character played by ${player.name}`}
                        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                      >
                        <option value="">— none —</option>
                        {playerCharacters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="ghost"
                        onClick={() => kickPlayer(player.id, player.name)}
                        className="text-red-600 dark:text-red-400"
                      >
                        Kick
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>Nobody has joined yet. Send them the code above.</EmptyState>
            )}
          </Panel>

          <Panel title="Add from library" scroll className="wide:order-2">
            {availableCharacters.length === 0 ? (
              <EmptyState>Every character in this campaign is already in the session.</EmptyState>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {availableCharacters.map((character) => (
                  <li key={character.id} className="flex items-center gap-3 py-2">
                    <CharacterThumb
                      kind={character.kind}
                      backgroundUrl={character.backgroundUrl}
                    />
                    <span className="flex-1 truncate text-sm text-stone-800 dark:text-stone-200">
                      {character.name}
                    </span>
                    <KindBadge kind={character.kind} />
                    <Button onClick={() => void addCharacter(character.id)} disabled={busy}>
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {viewingSheet ? (
        <SheetOverlay
          src={viewingSheet.sheetUrl}
          title={viewingSheet.name}
          onClose={() => setViewingSheet(null)}
        />
      ) : null}
    </AppPage>
  );
}
