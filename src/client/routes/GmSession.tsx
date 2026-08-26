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
  CountBadge,
  EmptyState,
  Icon,
  KindBadge,
  LoadingNote,
  Panel,
  TEXT_BODY,
  TEXT_MUTED,
  TEXT_STRONG,
} from "../components/ui.tsx";
import {
  faBook,
  faCopy,
  faLink,
  faStop,
  faUserPlus,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import type { VitalsPatch } from "../components/Vitals.tsx";
import { InitiativeList, stageLabel } from "../components/InitiativeList.tsx";
import { SegmentFilterToggle, useSegmentFilter } from "../components/SegmentFilter.tsx";
import { TurnControls } from "../components/TurnControls.tsx";
import { SheetOverlay } from "../components/SheetFrame.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Character, GameSession, SessionCharacter, Snapshot } from "../types.ts";

export function GmSessionConsole() {
  const { id: sessionId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const { snapshot, connection, applySnapshot } = useSessionSocket(sessionId);
  const [session, setSession] = useState<GameSession | null>(null);
  const [library, setLibrary] = useState<Character[]>([]);
  const [viewingSheet, setViewingSheet] = useState<SessionCharacter | null>(null);
  const [busy, setBusy] = useState(false);
  const [showActingOnly, toggleSegmentFilter] = useSegmentFilter(sessionId);

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

  /** Puts a character on the stage. An NPC asked for twice arrives twice. */
  const addCharacter = (characterId: string) =>
    mutate(() =>
      api.postJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/stage`, { characterId }),
    );

  /** Takes one slot off the stage, leaving any other copy of it where it is. */
  /**
   * Takes a character off the stage.
   *
   * It asks first only when someone is actually playing the character: removing
   * a claimed PC drops that player back to the pick-a-character screen mid-game,
   * which is not what a misplaced click should be able to do. Everything else —
   * an unclaimed hero, a goblin, one goblin of several — goes straight away,
   * because a fight is run by clicking quickly and a dialog in front of every
   * removal would be answered without being read.
   */
  const removeCharacter = async (slotId: string) => {
    const slot = snapshot?.characters.find((character) => character.id === slotId) ?? null;
    const heldBy = slot?.kind === "pc" ? slot.claimedByPlayerName : null;

    if (heldBy) {
      const ok = await confirm({
        title: `Take ${slot!.name} out of the scene?`,
        body: `${heldBy} is playing them, and will be asked to choose a character again. `
          + "Their initiative place goes with them.",
        confirmLabel: "Remove",
      });
      if (!ok) return;
    }

    void mutate(() =>
      api.delete<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/stage/${slotId}`),
    );
  };

  const setTurn = (slotId: string) =>
    mutate(() => api.postJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/turn`, {
      slotId,
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

  /**
   * Starts the fight over: turn one, segment twelve, no turn set.
   *
   * It asks first because it is the one turn control that throws work away —
   * several turns of tracking gone on one click, and the only way back is to
   * press Next as many times as it took to get there.
   */
  const restartTurns = async () => {
    const ok = await confirm({
      title: "Start over at turn 1?",
      body: "The fight goes back to turn 1, segment 12, with no turn set. Characters and their claims stay as they are.",
      confirmLabel: "Restart",
    });
    if (!ok) return;
    void mutate(() =>
      api.post<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/turn/restart`),
    );
  };

  const setVitals = (slotId: string, patch: VitalsPatch) =>
    mutate(() =>
      api.patchJson<{ snapshot: Snapshot }>(
        `/api/sessions/${sessionId}/stage/${slotId}/vitals`,
        patch,
      ),
    );

  const recover = (slotId: string) =>
    mutate(() =>
      api.post<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/stage/${slotId}/recover`),
    );

  const rest = (slotId: string) =>
    mutate(() =>
      api.post<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/stage/${slotId}/rest`),
    );

  const setClaim = (playerId: string, claimedCharacterId: string | null) =>
    mutate(() =>
      api.patchJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/players/${playerId}`, {
        claimedCharacterId,
      }),
    );

  const kickPlayer = async (playerId: string, name: string) => {
    const ok = await confirm({
      title: `Remove ${name} from this session?`,
      body: "They can rejoin with the session code.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    void mutate(() =>
      api.delete<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/players/${playerId}`),
    );
  };

  const endSession = async () => {
    const ok = await confirm({
      title: "End this session?",
      body: "The code stops working and everyone is disconnected.",
      confirmLabel: "End session",
    });
    if (!ok) return;
    try {
      await api.post(`/api/sessions/${sessionId}/end`);
      toast.show("Session ended.", "success");
      navigate("/gm");
    } catch (error) {
      toast.showError(error);
    }
  };

  if (!session) {
    return <LoadingNote>Loading session…</LoadingNote>;
  }

  // How many of each character are on the stage: the count beside a library card,
  // and what decides whether a PC still belongs in that list at all.
  const staged = new Map<string, number>();
  for (const character of snapshot?.characters ?? []) {
    staged.set(character.characterId, (staged.get(character.characterId) ?? 0) + 1);
  }

  // An NPC never leaves the library — a fight can always want another goblin. A
  // PC does, once it is on the stage: there is only ever one of a given hero, so
  // a card that could not be used again would just be in the way.
  const availableCharacters = library.filter(
    (character) => character.kind === "npc" || !staged.has(character.id),
  );
  const activeCharacter =
    snapshot?.characters.find((character) => character.id === snapshot.session.activeSlotId) ??
    null;
  const playerCharacters = snapshot?.characters.filter((c) => c.kind === "pc") ?? [];
  // The socket is the truth once it has spoken; the loaded session covers the
  // moment before it does.
  const segment = snapshot?.session.segment ?? session.segment;

  const joinUrl = `${location.origin}/join?code=${encodeURIComponent(session.code)}`;

  /*
   * The code, the two ways of handing it out, and the control that stops it
   * working. They belong together and they belong in a panel: the header is for
   * where you are and how the page looks, not for the session's own controls.
   */
  const invite = (
    <Panel className="order-first sm:order-none">
      <div className="flex flex-wrap items-center gap-3">
        <code className="rounded-lg bg-stone-100 px-3 py-2 font-mono text-sm tracking-wider text-stone-900 dark:bg-stone-800 dark:text-stone-100">
          {session.code}
        </code>
        <CopyButton value={session.code} label="Code" icon={faCopy} />
        <CopyButton value={joinUrl} label="Link" icon={faLink} />
        <Button variant="danger" onClick={() => void endSession()}>
          <Icon icon={faStop} /> End
        </Button>
      </div>
    </Panel>
  );

  return (
    <AppPage>
      {/*
        Three tracks rather than a row with the name in the middle of it: the
        outer two are equal, so the campaign's name is centred on the page rather
        than on whatever is left over between the button and the toggle, and it
        stays put as the reconnecting note comes and goes.
      */}
      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="justify-self-start">
          <Button variant="ghost" onClick={() => navigate("/gm")}>
            <Icon icon={faBook} /> Library
          </Button>
        </div>

        <h1 className={`truncate text-center text-xl font-semibold ${TEXT_STRONG}`}>
          {session.campaignName}
        </h1>

        <div className="flex flex-wrap items-center justify-end gap-2 justify-self-end">
          {connection === "reconnecting" ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Reconnecting…</span>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {/*
        Three panels' worth of console, in as many columns as the glass allows:
        one on a phone, two halves on anything wider, three thirds where the
        screen is a dashboard. The turn belongs above the segment panel and
        the width of it — it is the same fight — so the two travel together as
        one column, and the library and the players share the other half until
        there is room for each to have a column of its own.

        The wrappers are `display: contents` until their column exists, so the
        panels are items of one flow while stacked and `order` alone puts the
        library between the order it feeds and the players, rather than a second
        copy of the markup saying so.

        Nothing here grows: every panel is a flex item at its natural height, so
        a short list ends where its content does. `scroll` on the lists is the
        guard for the other direction — a list taller than the fixed wide frame
        shrinks back and scrolls its own body instead of being clipped by it.
      */}
      <div className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:items-start sm:gap-2.5 wide:min-h-0 wide:flex-1 wide:grid-cols-3 wide:items-stretch">
        <div className="contents sm:flex sm:min-w-0 sm:flex-col sm:gap-2.5 wide:order-1 wide:min-h-0">
          <TurnControls
            className="sm:shrink-0"
            turn={snapshot?.session.turn ?? session.turn}
            activeCharacterName={
              activeCharacter ? stageLabel(snapshot?.characters ?? [], activeCharacter) : null
            }
            editable
            onAdvance={advanceTurn}
            onRestart={() => void restartTurns()}
            disabled={busy || (snapshot?.characters.length ?? 0) === 0}
          />

          <Panel
            title={`Segment ${segment} (${snapshot?.characters.length ?? 0})`}
            actions={
              <SegmentFilterToggle showActingOnly={showActingOnly} onToggle={toggleSegmentFilter} />
            }
            scroll
          >
          {snapshot && snapshot.characters.length > 0 ? (
            <>
              <p className={`mb-2 text-xs ${TEXT_MUTED}`}>
                Ordered by SPD, then DEX+INIT. Use the arrow keys to move the turn marker.
              </p>
              <InitiativeList
                characters={snapshot.characters}
                segment={segment}
                showActingOnly={showActingOnly}
                activeSlotId={snapshot.session.activeSlotId}
                editable
                onSetVitals={(id, patch) => void setVitals(id, patch)}
                onRecover={(id) => void recover(id)}
                onRest={(id) => void rest(id)}
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
        </div>

        {/*
          The other half: who is here, then who could be added. On a wide screen
          the two part company — the library belongs beside the order it feeds,
          which puts the players last — so each takes a column of its own.
        */}
        <div className="contents sm:flex sm:min-w-0 sm:flex-col sm:gap-2.5 wide:contents">
          <div className="contents wide:order-3 wide:flex wide:min-h-0 wide:min-w-0 wide:flex-col wide:gap-2.5">
          {invite}

          <Panel title={`Players (${snapshot?.players.length ?? 0})`} scroll>
            {snapshot && snapshot.players.length > 0 ? (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {snapshot.players.map((player) => {
                  const claimed = snapshot.characters.find(
                    (character) => character.characterId === player.claimedCharacterId,
                  );
                  return (
                    <li key={player.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={`truncate font-medium ${TEXT_STRONG}`}>{player.name}</p>
                        <p className={`truncate text-xs ${TEXT_MUTED}`}>
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
                          // Valued by the character: a claim is on the hero, not
                          // on the slot they happen to be standing in.
                          <option key={character.id} value={character.characterId}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="dangerGhost"
                        onClick={() => void kickPlayer(player.id, player.name)}
                      >
                        <Icon icon={faUserSlash} /> Kick
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>Nobody has joined yet. Send them the code above.</EmptyState>
            )}
          </Panel>
          </div>

          <div className="contents wide:order-2 wide:flex wide:min-h-0 wide:min-w-0 wide:flex-col">
          <Panel title="Add from library" scroll>
            {availableCharacters.length === 0 ? (
              <EmptyState>
                This campaign has no NPCs, and every player character is already in the
                session.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {availableCharacters.map((character) => (
                  <li key={character.id} className="flex items-center gap-3 py-2">
                    <CharacterThumb
                      kind={character.kind}
                      backgroundUrl={character.backgroundUrl}
                    />
                    <span className={`flex-1 truncate text-sm ${TEXT_BODY}`}>{character.name}</span>
                    {/* How many of this one are out there already. Absent rather
                        than zero when there are none, so the row stays quiet. */}
                    {staged.has(character.id) ? (
                      <CountBadge title={`${staged.get(character.id)} in the session`}>
                        {staged.get(character.id)}
                      </CountBadge>
                    ) : null}
                    <KindBadge kind={character.kind} />
                    <Button onClick={() => void addCharacter(character.id)} disabled={busy}>
                      <Icon icon={faUserPlus} /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          </div>
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
