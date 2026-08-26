/**
 * The player's view of a session.
 *
 * Two panels, as the spec asks: everyone who has joined, and every active
 * character in initiative order with the player each one belongs to. Both update
 * live — a character the game master adds or removes, a reorder, or a change of
 * turn all arrive over the socket without a refresh.
 *
 * A player who hasn't picked a character yet is asked to choose one first.
 *
 * When the turn reaches this player's character they get a toast and a chime,
 * since a table is a room full of distractions and the highlighted row alone is
 * easy to miss.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { playDing } from "../ding.ts";
import { useSessionSocket } from "../useSessionSocket.ts";
import {
  AppPage,
  Button,
  CARD_BASE,
  CARD_CAPTION,
  CARD_GRID,
  CARD_NAME,
  CardPicture,
  CardWell,
  CharacterThumb,
  EmptyState,
  LoadingNote,
  Panel,
  SURFACE,
  TEXT_MUTED,
  TEXT_STRONG,
} from "../components/ui.tsx";
import { InitiativeList, stageLabel } from "../components/InitiativeList.tsx";
import { SegmentFilterToggle, useSegmentFilter } from "../components/SegmentFilter.tsx";
import { Vitals, type VitalsPatch } from "../components/Vitals.tsx";
import { faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import { HERO_STAT_LABELS } from "../../lib/hero.ts";
import { TurnControls } from "../components/TurnControls.tsx";
import { SheetOverlay } from "../components/SheetFrame.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Snapshot } from "../types.ts";

function Notice({ title, body, onLeave }: { title: string; body: string; onLeave: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className={`max-w-md p-6 text-center shadow-sm ${SURFACE}`}>
        <h1 className={`text-lg font-semibold ${TEXT_STRONG}`}>{title}</h1>
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
  const [dropped, setDropped] = useState(false);
  const [showActingOnly, toggleSegmentFilter] = useSegmentFilter(sessionId);

  /**
   * A player who is away long enough is removed from the session, and a removed
   * player's socket is refused rather than told why. Without this, a laptop
   * opened again after an hour would retry behind "Reconnecting…" forever, so
   * while the socket is away we ask who we are: an answer that is no longer this
   * player means the seat is gone and there is nothing to reconnect to.
   */
  useEffect(() => {
    if (connection !== "reconnecting") return;

    const check = async () => {
      try {
        const identity = await api.get<{ kind: string }>("/api/auth/me");
        if (identity.kind !== "player") setDropped(true);
      } catch {
        // Offline, or the server is down. Either way the socket keeps trying.
      }
    };

    const timer = setInterval(() => void check(), 5000);
    return () => clearInterval(timer);
  }, [connection]);

  // Identifies this player's turn, changing again if the order comes back round
  // to them — with one character in the scene the id alone would never change.
  //
  // Keyed on the slot and on where the clock is, so a character with two phases
  // in one turn is announced for each of them — a SPD 12 hero would otherwise be
  // chimed at once and then sit through eleven silent segments of their own.
  const myTurnKey = (() => {
    if (!snapshot) return null;
    const claimed =
      snapshot.players.find((player) => player.id === playerId)?.claimedCharacterId ?? null;
    const active = snapshot.session.activeSlotId;
    if (!claimed || !active) return null;
    const mine = snapshot.characters.some(
      (character) => character.id === active && character.characterId === claimed,
    );
    return mine ? `${active}#${snapshot.session.turn}#${snapshot.session.segment}` : null;
  })();

  // `undefined` until the first snapshot lands: arriving mid-turn is not a change,
  // and neither is the snapshot a reconnect replays.
  const announcedTurn = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!snapshot) return;
    const previous = announcedTurn.current;
    announcedTurn.current = myTurnKey;
    if (previous === undefined || !myTurnKey || myTurnKey === previous) return;

    toast.show("It's your turn!", "success");
    void playDing();
  }, [snapshot, myTurnKey, toast]);

  if (connection === "ended") {
    return (
      <Notice
        title="The session has ended"
        body="Your game master closed this session. The code will no longer work."
        onLeave={onLeave}
      />
    );
  }

  if (dropped) {
    return (
      <Notice
        title="You were away too long"
        body="Your seat was given up while you were disconnected. Join again with the same code — your game master can hand your character back."
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
    return <LoadingNote>Connecting to the table…</LoadingNote>;
  }

  const me = snapshot.players.find((player) => player.id === playerId) ?? null;
  const myCharacterId = me?.claimedCharacterId ?? null;
  const myCharacter =
    snapshot.characters.find((character) => character.characterId === myCharacterId) ?? null;

  /**
   * What this player's character has left. Only ever their own: the server
   * checks that too, since a screen is not where a rule like that lives.
   */
  const setVitals = async (slotId: string, patch: VitalsPatch) => {
    try {
      const { snapshot: next } = await api.patchJson<{ snapshot: Snapshot }>(
        `/api/sessions/${sessionId}/stage/${slotId}/vitals`,
        patch,
      );
      applySnapshot(next);
    } catch (error) {
      toast.showError(error);
    }
  };

  /** A Recovery for this player's own character; the totals are the server's. */
  const recover = async (slotId: string) => {
    try {
      const { snapshot: next } = await api.post<{ snapshot: Snapshot }>(
        `/api/sessions/${sessionId}/stage/${slotId}/recover`,
      );
      applySnapshot(next);
    } catch (error) {
      toast.showError(error);
    }
  };

  /** A rest for this player's own character: END and STUN back to full. */
  const rest = async (slotId: string) => {
    try {
      const { snapshot: next } = await api.post<{ snapshot: Snapshot }>(
        `/api/sessions/${sessionId}/stage/${slotId}/rest`,
      );
      applySnapshot(next);
    } catch (error) {
      toast.showError(error);
    }
  };

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
    // The snapshot arrives in initiative order, which is the wrong order for
    // finding your own character in a list of names.
    const available = snapshot.characters
      .filter((character) => character.kind === "pc" && character.claimedByPlayerId === null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    return (
      <div className="w-full p-2 sm:p-3">
        <header className="mb-6 flex items-center justify-between">
          <h1 className={`text-xl font-semibold ${TEXT_STRONG}`}>Welcome, {playerName}</h1>
          <ThemeToggle />
        </header>

        <Panel title="Choose your character">
          {available.length === 0 ? (
            <EmptyState>
              No player characters are free right now. Your game master can add more — this list
              updates on its own.
            </EmptyState>
          ) : (
            // Built from the same two constants as the library cards, so a player
            // sees the shape the game master saw. The whole tile is the button
            // here, since picking a character is all there is to do with one.
            <div className={CARD_GRID}>
              {available.map((character) => (
                <button
                  key={character.id}
                  type="button"
                  disabled={claiming}
                  onClick={() => void claim(character.characterId)}
                  className={`${CARD_BASE} border-stone-200 bg-white text-left disabled:opacity-50 dark:border-stone-800 dark:bg-stone-900`}
                >
                  <CardWell>
                    <CardPicture src={character.backgroundUrl} icon={faShieldHalved} />
                  </CardWell>
                  <div className={CARD_CAPTION}>
                    <p className={CARD_NAME}>
                      {character.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    );
  }

  return (
    <AppPage>
      {/*
        The campaign heads the page, as it does the game master's console: who
        the player is and who they are playing are both on their own panel a few
        lines below, and repeating them up here said nothing the rest of the
        screen was not already saying.

        Three tracks rather than a row, so the name is centred on the page rather
        than on what is left over beside the controls, and stays put as the
        reconnecting note comes and goes.
      */}
      <header className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div />

        <h1 className={`truncate text-center text-xl font-semibold ${TEXT_STRONG}`}>
          {snapshot.session.campaignName}
        </h1>

        <div className="flex items-center justify-end gap-2">
          {connection === "reconnecting" ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">Reconnecting…</span>
          ) : null}
          <ThemeToggle />
          <Button onClick={onLeave}>Leave</Button>
        </div>
      </header>

      {/*
        Two columns on a large screen, one on a narrow one — and the stacked order
        interleaves them, since the scene belongs above the player list on a phone
        but beside it on a monitor. The wrappers are `display: contents` until the
        columns exist, so all four panels are items of the one column and `order`
        alone decides where the player list falls; the same trick the game master's
        console uses (GmSession.tsx).

        Nothing here grows. Every panel is a flex item at its natural height, so a
        short list ends where its content does rather than being stretched to the
        frame. `scroll` on the two lists is only a guard for the other direction: a
        list taller than the fixed wide frame shrinks back and scrolls its own body
        instead of spilling out of the page, which the wide layout clips.
      */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start lg:gap-2.5 wide:min-h-0 wide:flex-1 wide:items-stretch">
        <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col lg:gap-2.5 wide:min-h-0">
          <TurnControls
            className="lg:shrink-0"
            turn={snapshot.session.turn}
            activeCharacterName={(() => {
              const active = snapshot.characters.find(
                (character) => character.id === snapshot.session.activeSlotId,
              );
              return active ? stageLabel(snapshot.characters, active) : null;
            })()}
            editable={false}
          />

          <Panel
            title="My character"
            className="lg:shrink-0"
            actions={
              myCharacter ? (
                <Button onClick={() => setSheetOpen(true)}>My sheet</Button>
              ) : null
            }
          >
            {myCharacter ? (
              // Nothing in here wraps. This panel is one character's own line of
              // numbers, and a row that folds in half on a phone reads as two
              // characters at a glance — worse than a line that has to be pushed
              // sideways to see the end of. A name too long for the panel is cut
              // with an ellipsis for the same reason; the whole of it is on the
              // page header above.
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <CharacterThumb
                    kind={myCharacter.kind}
                    backgroundUrl={myCharacter.backgroundUrl}
                  />
                  <div className="min-w-0">
                    <p className={`truncate font-medium ${TEXT_STRONG}`}>{myCharacter.name}</p>
                    <p className={`truncate text-xs tabular-nums ${TEXT_MUTED}`}>
                      {HERO_STAT_LABELS.speed} {myCharacter.speed} ·{" "}
                      {HERO_STAT_LABELS.dexterity} {myCharacter.dexterity} ·{" "}
                      {HERO_STAT_LABELS.recovery} {myCharacter.recovery}
                    </p>
                  </div>
                </div>
                {/* Spent during a fight, and this player's own to spend. */}
                <Vitals
                  character={myCharacter}
                  wrap={false}
                  onChange={(patch) => void setVitals(myCharacter.id, patch)}
                  onRecover={() => void recover(myCharacter.id)}
                  onRest={() => void rest(myCharacter.id)}
                />
              </div>
            ) : (
              <EmptyState>
                Your character isn't in the scene right now. Your game master can bring them
                back.
              </EmptyState>
            )}
          </Panel>

          <Panel
            title={`Players (${snapshot.players.length})`}
            scroll
            className="order-last lg:order-none"
          >
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {snapshot.players.map((player) => {
                const character = snapshot.characters.find(
                  (entry) => entry.characterId === player.claimedCharacterId,
                );
                return (
                  <li key={player.id} className="py-2.5">
                    <p className={`font-medium ${TEXT_STRONG}`}>
                      {player.name}
                      {player.id === playerId ? (
                        <span className={`ml-1.5 text-xs font-normal ${TEXT_MUTED}`}>(you)</span>
                      ) : null}
                    </p>
                    <p className={`text-xs ${TEXT_MUTED}`}>
                      {character ? `Playing ${character.name}` : "Choosing a character…"}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-[1.4] lg:flex-col wide:min-h-0">
          <Panel
            scroll
            title={`Segment ${snapshot.session.segment} (${snapshot.characters.length})`}
            actions={
              <SegmentFilterToggle showActingOnly={showActingOnly} onToggle={toggleSegmentFilter} />
            }
          >
            {snapshot.characters.length === 0 ? (
              <EmptyState>Your game master hasn't brought anyone into the scene yet.</EmptyState>
            ) : (
              <InitiativeList
                characters={snapshot.characters}
                segment={snapshot.session.segment}
                showActingOnly={showActingOnly}
                activeSlotId={snapshot.session.activeSlotId}
                yourCharacterId={myCharacterId}
              />
            )}
          </Panel>
        </div>
      </div>

      {sheetOpen && myCharacter ? (
        <SheetOverlay
          src={myCharacter.sheetUrl}
          title={myCharacter.name}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </AppPage>
  );
}
