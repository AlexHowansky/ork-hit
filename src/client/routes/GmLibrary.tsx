/**
 * The game master's library: campaigns and the characters filed under them, both
 * presented as cards, plus the controls for starting a session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { faScroll } from "@fortawesome/free-solid-svg-icons";
import { HERO_STAT_FIELDS, HERO_STAT_LABELS } from "../../lib/hero.ts";
import { useSessionSocket } from "../useSessionSocket.ts";
import { useLiveSessions } from "../useLiveSessions.ts";
import { useCardFit } from "../useCardFit.ts";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import {
  AppPage,
  Button,
  CARD_BASE,
  CARD_CAPTION,
  CARD_GRID,
  CHARACTER_DRAG,
  CardActions,
  DeleteIcon,
  EditIcon,
  EmptyState,
  Field,
  FileDrop,
  Icon,
  IconButton,
  Modal,
  Panel,
  SheetIcon,
  useDropTarget,
  useFileDropTarget,
} from "../components/ui.tsx";
import { CharacterCard } from "../components/CharacterCard.tsx";
import { SheetOverlay } from "../components/SheetFrame.tsx";
import { useConfirm } from "../components/Confirm.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Campaign, Character, GameSession } from "../types.ts";

/** Mirrors `limits.nameMaxLength` on the server, which is what rejects a longer one. */
const NAME_MAX_LENGTH = 60;

/* ------------------------------------------------------------------- dialogs */

function CampaignForm({
  campaign,
  onDone,
}: {
  campaign: Campaign | null;
  onDone: (campaign: Campaign) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(campaign?.name ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("name", name);
    setBusy(true);
    try {
      const result = campaign
        ? await api.patchForm<{ campaign: Campaign }>(`/api/campaigns/${campaign.id}`, form)
        : await api.postForm<{ campaign: Campaign }>("/api/campaigns", form);
      onDone(result.campaign);
    } catch (error) {
      toast.showError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field
        label="Campaign name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
        hint="Campaign names are unique."
      />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Background image (optional)
        </span>
        <input
          type="file"
          name="background"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-200 file:px-3 file:py-1.5 file:text-sm dark:text-stone-400 dark:file:bg-stone-800 dark:file:text-stone-200"
        />
      </label>
      {campaign?.backgroundUrl ? (
        <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
          <input type="checkbox" name="removeBackground" value="true" />
          Remove the current background
        </label>
      ) : null}
      <Button variant="primary" type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : campaign ? "Save changes" : "Create campaign"}
      </Button>
    </form>
  );
}

function CharacterForm({
  campaigns,
  character,
  defaultCampaignId,
  droppedFile,
  onDone,
}: {
  campaigns: Campaign[];
  character: Character | null;
  defaultCampaignId: string;
  /** Set when the dialog was opened by dropping a sheet on the panel. */
  droppedFile: File | null;
  onDone: (character: Character) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(character?.name ?? "");
  // What the last uploaded sheet put in the name field. Anything else in there is
  // the game master's own typing, and a second upload must not overwrite it.
  const suggested = useRef<string | null>(null);

  /**
   * Names the character after the file, since a sheet is nearly always saved
   * under the character's name and retyping it is busywork.
   *
   * Only into an empty field, or over a name this same mechanism put there. The
   * extension goes; nothing else about the filename is second-guessed.
   */
  const suggestNameFrom = (file: File) => {
    if (name !== "" && name !== suggested.current) return;
    const stripped = file.name.replace(/\.[^.]+$/, "").trim().slice(0, NAME_MAX_LENGTH);
    if (!stripped) return;
    suggested.current = stripped;
    setName(stripped);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = character
        ? await api.patchForm<{ character: Character }>(`/api/characters/${character.id}`, form)
        : await api.postForm<{ character: Character }>("/api/characters", form);
      onDone(result.character);
    } catch (error) {
      toast.showError(error);
    } finally {
      setBusy(false);
    }
  };

  const selectClass =
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100";

  // The sheet leads: uploading it is the point of the dialog, and the fields
  // below it are the filing — what this character is, where it belongs, what it
  // looks like — in the order someone answers them.
  return (
    <form onSubmit={submit} className="space-y-4">
      <FileDrop
        label={`Character sheet ${
          character ? "(leave empty to keep the current one)" : "(HTML file)"
        }`}
        name="sheet"
        accept=".html,.htm,text/html"
        hint="Sheets keep their own scripts and styling. They are displayed in an isolated frame, so they cannot interact with the rest of this app."
        onFile={suggestNameFrom}
        initialFile={droppedFile}
      />

      <Field
        label="Name"
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Type
        </span>
        <select name="kind" defaultValue={character?.kind ?? "pc"} className={selectClass}>
          <option value="pc">Player character</option>
          <option value="npc">Non-player character</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Campaign
        </span>
        <select
          name="campaignId"
          defaultValue={character?.campaignId ?? defaultCampaignId}
          required
          className={selectClass}
        >
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
      </label>

      {/*
        The HERO characteristics, six to a block rather than six stacked rows:
        they are short numbers and reading them across is how a character sheet
        prints them. A character nobody has filled in yet is all zeros, which is
        a legitimate thing to save.
      */}
      <fieldset>
        <legend className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Characteristics
        </legend>
        <div className="grid grid-cols-3 gap-3">
          {HERO_STAT_FIELDS.map((field) => (
            <Field
              key={field}
              label={HERO_STAT_LABELS[field]}
              name={field}
              type="number"
              inputMode="numeric"
              defaultValue={character?.[field] ?? 0}
            />
          ))}
        </div>
      </fieldset>

      <FileDrop
        label="Background image (optional)"
        name="background"
        accept="image/png,image/jpeg,image/gif,image/webp"
      />

      <Button variant="primary" type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : character ? "Save changes" : "Add character"}
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------------- page */

/**
 * One line in "sessions in progress".
 *
 * It opens the session's socket so the player count is live: the server
 * republishes the session whenever anyone joins, leaves, or is kicked, and the
 * count comes from that rather than from the list, which is only as fresh as the
 * last time the page loaded. Until the first snapshot arrives — and if the socket
 * drops — the count from the list stands in.
 */
function SessionRow({
  session,
  onOpen,
  onEnd,
}: {
  session: GameSession;
  onOpen: () => void;
  onEnd: () => void;
}) {
  const { snapshot } = useSessionSocket(session.id);
  const playerCount = snapshot?.players.length ?? session.playerCount;
  const round = snapshot?.session.round ?? session.round;

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-stone-700 dark:text-stone-300">
        {session.campaignName}
        <span className="ml-2 text-xs text-stone-500 dark:text-stone-400">
          round {round} ·{" "}
          {playerCount === 0
            ? "nobody has joined"
            : `${playerCount} player${playerCount === 1 ? "" : "s"}`}
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="dangerGhost" onClick={onEnd}>
          End session
        </Button>
        <Button onClick={onOpen}>Open console</Button>
      </div>
    </div>
  );
}

/**
 * A campaign in the library, and the thing a character is refiled by being dropped
 * onto it.
 *
 * It is a component of its own rather than markup inside the map because the drop
 * target is a hook. `takes` is the character that would move if it were let go here
 * — null when nothing is being dragged, and null on the card of the campaign the
 * character is already in, so its own campaign never invites a move that would do
 * nothing.
 *
 * The drop cue is a ring with an offset, which is a different shape from both the
 * selection ring this card may already be wearing and the one the character panel
 * draws for a file, so the three never read as each other.
 */
function CampaignCard({
  campaign,
  selected,
  onSelect,
  onEdit,
  onDelete,
  takes,
  onTake,
}: {
  campaign: Campaign;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  takes: Character | null;
  onTake: (character: Character) => void;
}) {
  const { over, dropProps } = useDropTarget(CHARACTER_DRAG, () => takes && onTake(takes));
  const inviting = over && takes !== null;

  return (
    <article
      {...(takes ? dropProps : {})}
      className={`${CARD_BASE} ${
        inviting
          ? "border-amber-500 ring-2 ring-amber-500 ring-offset-2 ring-offset-stone-100 dark:ring-offset-stone-950"
          : selected
            ? "border-amber-500 ring-2 ring-amber-500/30"
            : "border-stone-200 dark:border-stone-800"
      } bg-white dark:bg-stone-900`}
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-stone-200 dark:bg-stone-800">
        <button
          type="button"
          onClick={onSelect}
          className="absolute inset-0 h-full w-full text-left"
          aria-pressed={selected}
          aria-label={`Select ${campaign.name}`}
        >
          {campaign.backgroundUrl ? (
            <img
              src={campaign.backgroundUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 group-focus-within:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center opacity-30" aria-hidden>
              <Icon icon={faScroll} className="h-12 w-12" />
            </div>
          )}
        </button>
        <CardActions>
          <IconButton label={`Edit ${campaign.name}`} icon={<EditIcon />} onClick={onEdit} />
          <IconButton
            label={`Delete ${campaign.name}`}
            icon={<DeleteIcon />}
            danger
            onClick={onDelete}
          />
        </CardActions>
      </div>

      <div className={CARD_CAPTION}>
        <h3 className="truncate font-medium text-stone-900 dark:text-stone-100">{campaign.name}</h3>
      </div>
    </article>
  );
}

export function GmLibrary({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  // Fetched with everything else below, then kept current by the library socket.
  const { sessions, setSessions } = useLiveSessions();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [campaignDialog, setCampaignDialog] = useState<{ open: boolean; editing: Campaign | null }>(
    { open: false, editing: null },
  );
  const [characterDialog, setCharacterDialog] = useState<{
    open: boolean;
    editing: Character | null;
    /** The sheet a drop on the panel arrived with, if that is how this opened. */
    file: File | null;
  }>({ open: false, editing: null, file: null });
  const [previewing, setPreviewing] = useState<Character | null>(null);
  /**
   * The character being dragged, if one is.
   *
   * `dataTransfer` carries the marker type and the id, but during `dragover` the
   * payload is unreadable — and a campaign card has to know, while the drag is
   * still in the air, whether letting go here would move anything at all.
   */
  const [dragging, setDragging] = useState<Character | null>(null);

  // Trims the campaign panel to whole card columns, giving the leftover to the
  // characters beside it.
  const { containerRef, panelRef, gridRef } = useCardFit({ count: campaigns.length });

  const load = useCallback(async () => {
    try {
      const [campaignData, characterData, sessionData] = await Promise.all([
        api.get<{ campaigns: Campaign[] }>("/api/campaigns"),
        api.get<{ characters: Character[] }>("/api/characters"),
        api.get<{ sessions: GameSession[] }>("/api/sessions"),
      ]);
      setCampaigns(campaignData.campaigns);
      setCharacters(characterData.characters);
      setSessions(sessionData.sessions);
      setSelectedCampaignId((current) => current ?? campaignData.campaigns[0]?.id ?? null);
    } catch (error) {
      toast.showError(error);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Dropping a sheet on the character panel opens the add dialog holding it, so
   * a folder of sheets can be filed without opening the dialog first each time.
   * The panel only exists while a campaign is selected, so there is never a
   * question of which campaign a dropped character belongs to.
   *
   * One file: the dialog files one character, as the field inside it does.
   */
  const { over: sheetOver, dropProps: sheetDrop } = useFileDropTarget((files) => {
    const file = files.item(0);
    if (file) setCharacterDialog({ open: true, editing: null, file });
  });

  // Having invited a drag onto the page, catch the ones that miss: a file dropped
  // anywhere else would otherwise be opened by the browser, throwing the library
  // away to show a character sheet as a bare page.
  // A character dragged onto nothing in particular is left alone, so the browser
  // shows a no-drop cursor over everything that isn't a campaign and the gesture
  // simply ends where it started.
  useEffect(() => {
    const swallow = (event: Event) => {
      const transfer = (event as globalThis.DragEvent).dataTransfer;
      if (transfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const visibleCharacters = characters.filter(
    (character) => character.campaignId === selectedCampaignId,
  );
  const activeSessions = sessions.filter((session) => session.status === "active");
  // A campaign runs one session at a time, so the button that would start a
  // second one opens the first instead.
  const runningHere = activeSessions.find(
    (session) => session.campaignId === selectedCampaignId,
  );

  /**
   * Ends a session without opening its console.
   *
   * Named by campaign rather than "this session": the library can be showing
   * several at once, and the console's wording would leave the game master
   * guessing which one they are about to close.
   *
   * Nothing is reloaded afterwards — ending broadcasts the session list to the
   * library socket, so the row goes on its own.
   */
  const endSession = async (session: GameSession) => {
    const ok = await confirm({
      title: `End the session on “${session.campaignName}”?`,
      body: "The code stops working and everyone is disconnected.",
      confirmLabel: "End session",
    });
    if (!ok) return;
    try {
      await api.post(`/api/sessions/${session.id}/end`);
      toast.show("Session ended.", "success");
    } catch (error) {
      toast.showError(error);
    }
  };

  const deleteCampaign = async (campaign: Campaign) => {
    const ok = await confirm({
      title: `Delete “${campaign.name}”?`,
      body: "Its characters and sessions will be deleted too.",
      confirmLabel: "Delete campaign",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/campaigns/${campaign.id}`);
      setSelectedCampaignId(null);
      toast.show(`Deleted “${campaign.name}”.`, "success");
      await load();
    } catch (error) {
      toast.showError(error);
    }
  };

  const deleteCharacter = async (character: Character) => {
    const ok = await confirm({
      title: `Delete “${character.name}”?`,
      confirmLabel: "Delete character",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/characters/${character.id}`);
      setCharacters((current) => current.filter((entry) => entry.id !== character.id));
      toast.show(`Deleted “${character.name}”.`, "success");
    } catch (error) {
      toast.showError(error);
    }
  };

  /**
   * Refiles a character under another campaign, which is what a drop onto a
   * campaign card means.
   *
   * The selection stays where it is: the character simply leaves the list, so a
   * run of characters can be filed out of one campaign without re-selecting it
   * between each. The server may refuse — a name the destination already has, or
   * a character still playing in a running session — and says why in a message
   * the toast can show as it stands.
   */
  const moveCharacter = async (character: Character, campaign: Campaign) => {
    const form = new FormData();
    form.set("campaignId", campaign.id);
    try {
      const { character: moved } = await api.patchForm<{ character: Character }>(
        `/api/characters/${character.id}`,
        form,
      );
      setCharacters((current) => current.map((entry) => (entry.id === moved.id ? moved : entry)));
      toast.show(`Moved “${moved.name}” to “${campaign.name}”.`, "success");
    } catch (error) {
      toast.showError(error);
    }
  };

  const startSession = async () => {
    if (!selectedCampaign) return;
    try {
      const result = await api.postJson<{ session: GameSession }>("/api/sessions", {
        campaignId: selectedCampaign.id,
      });
      navigate(`/gm/sessions/${result.session.id}`);
    } catch (error) {
      toast.showError(error);
    }
  };

  if (loading) {
    return <p className="p-8 text-center text-stone-500 dark:text-stone-400">Loading your library…</p>;
  }

  return (
    <AppPage>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">Your library</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400">Signed in as {email}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </header>

      {activeSessions.length > 0 ? (
        <Panel title={`Sessions in progress (${activeSessions.length})`} className="shrink-0">
          <ul className="space-y-2">
            {activeSessions.map((session) => (
              <li key={session.id}>
                <SessionRow
                  session={session}
                  onOpen={() => navigate(`/gm/sessions/${session.id}`)}
                  onEnd={() => void endSession(session)}
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div
        ref={containerRef}
        className="space-y-6 wide:grid wide:min-h-0 wide:flex-1 wide:grid-cols-[var(--campaign-col)_minmax(0,1.4fr)] wide:gap-6 wide:space-y-0"
      >
        <Panel
          ref={panelRef}
          title="Campaigns"
          scroll
          actions={
            <Button
              variant="primary"
              onClick={() => setCampaignDialog({ open: true, editing: null })}
            >
              New campaign
            </Button>
          }
        >
          {campaigns.length === 0 ? (
            <EmptyState>No campaigns yet. Create one to get started.</EmptyState>
          ) : (
            <div ref={gridRef} className={CARD_GRID}>
              {campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  selected={campaign.id === selectedCampaignId}
                  onSelect={() => setSelectedCampaignId(campaign.id)}
                  onEdit={() => setCampaignDialog({ open: true, editing: campaign })}
                  onDelete={() => void deleteCampaign(campaign)}
                  takes={dragging && dragging.campaignId !== campaign.id ? dragging : null}
                  onTake={(character) => void moveCharacter(character, campaign)}
                />
              ))}
            </div>
          )}
        </Panel>

        {selectedCampaign ? (
          <Panel
            scroll
            {...sheetDrop}
            // A ring rather than a border or a background tint: those would fight
            // the panel's own `border-stone-200` and `bg-white` for the same
            // property, and which wins is down to stylesheet order.
            className={sheetOver ? "ring-2 ring-amber-500" : ""}
            title={`Characters in ${selectedCampaign.name}`}
            actions={
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => setCharacterDialog({ open: true, editing: null, file: null })}
                >
                  Add character
                </Button>
                {runningHere ? (
                  <Button onClick={() => navigate(`/gm/sessions/${runningHere.id}`)}>
                    Open console
                  </Button>
                ) : (
                  <Button onClick={() => void startSession()}>Start session</Button>
                )}
              </div>
            }
          >
            {visibleCharacters.length === 0 ? (
              <EmptyState>
                No characters in this campaign yet. Drop an HTML sheet here, or add one with
                the button above.
              </EmptyState>
            ) : (
              <div className={CARD_GRID}>
                {visibleCharacters.map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    onOpen={() => setPreviewing(character)}
                    dragProps={{
                      draggable: true,
                      onDragStart: (event) => {
                        event.dataTransfer.setData(CHARACTER_DRAG, character.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(character);
                      },
                      onDragEnd: () => setDragging(null),
                    }}
                    actions={
                      <>
                        <IconButton
                          label={`View ${character.name}'s sheet`}
                          icon={<SheetIcon />}
                          onClick={() => setPreviewing(character)}
                        />
                        <IconButton
                          label={`Edit ${character.name}`}
                          icon={<EditIcon />}
                          onClick={() => setCharacterDialog({ open: true, editing: character, file: null })}
                        />
                        <IconButton
                          label={`Delete ${character.name}`}
                          icon={<DeleteIcon />}
                          danger
                          onClick={() => void deleteCharacter(character)}
                        />
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </Panel>
        ) : null}
      </div>

      {campaignDialog.open ? (
        <Modal
          title={campaignDialog.editing ? "Edit campaign" : "New campaign"}
          onClose={() => setCampaignDialog({ open: false, editing: null })}
        >
          <CampaignForm
            campaign={campaignDialog.editing}
            onDone={async (campaign) => {
              setCampaignDialog({ open: false, editing: null });
              setSelectedCampaignId(campaign.id);
              await load();
            }}
          />
        </Modal>
      ) : null}

      {characterDialog.open && selectedCampaign ? (
        <Modal
          title={characterDialog.editing ? "Edit character" : "Add character"}
          onClose={() => setCharacterDialog({ open: false, editing: null, file: null })}
        >
          <CharacterForm
            campaigns={campaigns}
            character={characterDialog.editing}
            defaultCampaignId={selectedCampaign.id}
            droppedFile={characterDialog.file}
            onDone={async () => {
              setCharacterDialog({ open: false, editing: null, file: null });
              await load();
            }}
          />
        </Modal>
      ) : null}

      {previewing ? (
        <SheetOverlay
          src={previewing.sheetUrl}
          title={previewing.name}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </AppPage>
  );
}
