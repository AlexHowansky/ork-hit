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
  TEXT_MUTED,
} from "../components/ui.tsx";
import {
  faBook,
  faCopy,
  faEye,
  faLink,
  faRightFromBracket,
  faStop,
  faUserPlus,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import type { VitalsPatch } from "../components/Vitals.tsx";
import { InitiativeList, stageLabel } from "../components/InitiativeList.tsx";
import { LogDrawer, LogToggle, useLogDrawer } from "../components/EventLog.tsx";
import { SegmentFilterToggle, useSegmentFilter } from "../components/SegmentFilter.tsx";
import { TurnControls } from "../components/TurnControls.tsx";
import { SheetOverlay } from "../components/SheetFrame.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Character, GameSession, Snapshot } from "../types.ts";

export function GmSessionConsole({ onSignOut }: { onSignOut: () => void }) {
  const { id: sessionId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  // Anything the server wants said at the table — the Post-Segment 12 Recovery —
  // reaches every screen in the session as a toast. Green, like the turn passing
  // to your character: both are the fight going well rather than something
  // wanting attention.
  const { snapshot, connection, applySnapshot } = useSessionSocket(
    sessionId,
    (message) => toast.show(message, "success"),
  );
  const [session, setSession] = useState<GameSession | null>(null);
  const [library, setLibrary] = useState<Character[]>([]);
  // A library character rather than a stage slot: sheets are opened from the
  // library panel, which lists the campaign's characters whether they are in the
  // scene or not, and a sheet belongs to the character rather than to the copy.
  const [viewingSheet, setViewingSheet] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);
  const [showActingOnly, toggleSegmentFilter] = useSegmentFilter(sessionId);
  const [logOpen, toggleLog] = useLogDrawer(sessionId);

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

  const setStatusTag = (slotId: string, tag: string, active: boolean) =>
    mutate(() =>
      api.patchJson<{ snapshot: Snapshot }>(`/api/sessions/${sessionId}/stage/${slotId}/tags`, {
        tag,
        active,
      }),
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

  // How many of each character are on the stage: the count beside a library row,
  // and what decides whether a PC's Add button is still live.
  const staged = new Map<string, number>();
  for (const character of snapshot?.characters ?? []) {
    staged.set(character.characterId, (staged.get(character.characterId) ?? 0) + 1);
  }

  // Nobody leaves the library, on stage or not. A row that vanishes when its
  // character walks on reads the same as a character that was never in the
  // campaign; a row that stays, with its Add ghosted, says the hero is already
  // in.
  //
  // Four blocks, in the order a fight asks for them: whoever is already in the
  // scene first — heroes, then monsters — and then everybody who is not, in the
  // same two kinds. Who is in the scene is the thing a game master is looking
  // this panel up against, so it sorts before what kind they are. Alphabetically
  // inside each block, matching the `COLLATE NOCASE` the characters endpoint
  // already orders by — sorted here as well so the grouping is this panel's own
  // rather than something inherited from a query.
  const libraryRank = (character: Character) =>
    (staged.has(character.id) ? 0 : 2) + (character.kind === "pc" ? 0 : 1);

  const libraryOrder = [...library].sort(
    (a, b) =>
      libraryRank(a) - libraryRank(b) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  // The one row that has the scene above it and the rest of the campaign below.
  // There is at most one, since the sort puts everybody on stage first, and none
  // at all when the whole library is in the scene or none of it is.
  const opensTheOffStageBlock = (index: number) =>
    index > 0 &&
    !staged.has(libraryOrder[index]!.id) &&
    staged.has(libraryOrder[index - 1]!.id);
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
        <code className="rounded-lg bg-base-200 px-3 py-2 font-mono text-sm tracking-wider">
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
        {/* The log first, because it is what opens directly below it: the drawer
            comes out of this corner, so its control is the thing in the corner. */}
        <div className="flex flex-wrap items-center gap-2 justify-self-start">
          <LogToggle open={logOpen} onToggle={toggleLog} />
          <Button variant="ghost" onClick={() => navigate("/gm")}>
            <Icon icon={faBook} /> Library
          </Button>
        </div>

        <h1 className="truncate text-center text-xl font-semibold">
          {session.campaignName}
        </h1>

        <div className="flex flex-wrap items-center justify-end gap-2 justify-self-end">
          {connection === "reconnecting" ? (
            <span className="badge badge-sm badge-warning badge-soft">Reconnecting…</span>
          ) : null}
          <ThemeToggle />
          {/* Signing out is about this browser, not about the table: the session
              keeps running and the code keeps working. Ending it is the `End`
              button down in the panel with the code, where it belongs. */}
          <Button onClick={onSignOut}>
            <Icon icon={faRightFromBracket} /> Sign out
          </Button>
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
      {/*
        The log is a drawer beside the console rather than a panel inside it, and
        it pushes rather than covers: this row is the push. Closed it has no
        width, so the console is the whole of the row and the layout below is
        exactly what it was before the drawer existed.
      */}
      <div className="flex flex-col lg:flex-row lg:items-start wide:min-h-0 wide:flex-1 wide:items-stretch">
        <LogDrawer events={snapshot?.events ?? []} open={logOpen} onClose={toggleLog} />

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:items-start sm:gap-2.5 wide:min-h-0 wide:grid-cols-3 wide:items-stretch">
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
            title={`Segment ${segment}`}
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
                onToggleTag={(id, tag, active) => void setStatusTag(id, tag, active)}
                onSetTurn={(id) => void setTurn(id)}
                onRemove={(id) => void removeCharacter(id)}
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
              <ul className="divide-y divide-base-200">
                {snapshot.players.map((player) => {
                  const claimed = snapshot.characters.find(
                    (character) => character.characterId === player.claimedCharacterId,
                  );
                  return (
                    <li key={player.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{player.name}</p>
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
                        className="select select-xs w-auto"
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
          <Panel title="Library" scroll>
            {libraryOrder.length === 0 ? (
              <EmptyState>
                This campaign has no characters yet. They are made on the library page.
              </EmptyState>
            ) : (
              // The rules between rows are drawn per row rather than by `divide-y`,
              // because one of them is not like the others: where the scene ends
              // and the rest of the campaign begins, the line thickens. The four
              // blocks are otherwise told apart only by dimming and by kind
              // badges, and the eye finds a heavier rule before it reads either.
              //
              // It carries its own colour rather than `HAIRLINE`, which shares
              // its dark shade with the hairline below — two rules the same
              // colour and a pixel apart in weight is not a boundary anybody can
              // see. These two are picked to stand off the row rule in both
              // themes: darker than it on white, lighter than it on stone.
              <ul>
                {libraryOrder.map((character, index) => (
                  <li
                    key={character.id}
                    className={`flex items-center gap-3 py-2 ${
                      index === 0
                        ? ""
                        : opensTheOffStageBlock(index)
                          ? "border-t-2 border-base-content/30"
                          : "border-t border-base-200"
                    }`}
                  >
                    {/*
                      A character who is not in the scene is dimmed, the same way
                      the segment panel dims whoever has no phase this segment:
                      brightness is this panel's answer to "are they in the
                      fight", which is the question the four blocks are sorted by.

                      Everything but the Add button is inside it, because opacity
                      composites the whole subtree — a child cannot be brighter
                      than its parent, so the one control that should stay at full
                      strength has to sit outside the dimming rather than undo it.
                      And it is the one that should: adding them is exactly what a
                      game master is reaching for on a row that is not in yet.
                    */}
                    <div
                      className={`flex min-w-0 flex-1 items-center gap-3 ${
                        staged.has(character.id) ? "" : "opacity-60"
                      }`}
                    >
                      <CharacterThumb
                        kind={character.kind}
                        backgroundUrl={character.backgroundUrl}
                      />
                      <span className="flex-1 truncate text-sm">
                        {character.name}
                      </span>
                      {/* How many of this one are out there already. Only monsters
                          carry it: there is one of a given hero and never a second,
                          so a badge reading `1` beside them would be answering a
                          question nobody at the table can ask. Absent rather than
                          zero when there are none out, so the row stays quiet. */}
                      {character.kind === "npc" && staged.has(character.id) ? (
                        <CountBadge title={`${staged.get(character.id)} in the session`}>
                          {staged.get(character.id)}
                        </CountBadge>
                      ) : null}
                      <KindBadge kind={character.kind} />
                      {/* Sheets are opened from here rather than from the segment
                          panel: this list has every character in the campaign, so
                          one that has not walked on yet can still be read, and a
                          sheet is the character's rather than the copy's — two
                          goblins have one between them. */}
                      <Button variant="ghost" onClick={() => setViewingSheet(character)}>
                        <Icon icon={faEye} /> Sheet
                      </Button>
                    </div>
                    {/* A hero is on the stage once and no more, so their Add goes
                        quiet rather than away — the ghosting is `Button`'s own
                        `disabled:` styling. A monster's never does. */}
                    <Button
                      onClick={() => void addCharacter(character.id)}
                      disabled={busy || (character.kind === "pc" && staged.has(character.id))}
                      title={
                        character.kind === "pc" && staged.has(character.id)
                          ? `${character.name} is already in the session.`
                          : undefined
                      }
                    >
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
