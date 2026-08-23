/**
 * The game master's library: campaigns and the characters filed under them, both
 * presented as cards, plus the controls for starting a session.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api.ts";
import { useSessionSocket } from "../useSessionSocket.ts";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import {
  AppPage,
  Button,
  CARD_BASE,
  CARD_GRID,
  CardActions,
  DeleteIcon,
  EditIcon,
  EmptyState,
  Field,
  IconButton,
  Panel,
  SheetIcon,
} from "../components/ui.tsx";
import { CharacterCard } from "../components/CharacterCard.tsx";
import { SheetFrame } from "../components/SheetFrame.tsx";
import { useToast } from "../components/Toast.tsx";
import type { Campaign, Character, GameSession } from "../types.ts";

/* ------------------------------------------------------------------- dialogs */

function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  // Escape closes, which is the behaviour people expect from a dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-stone-900 ${
          wide ? "max-w-5xl wide:max-w-7xl" : "max-w-lg"
        }`}
      >
        <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3 dark:border-stone-800">
          <h2 className="font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </div>
    </div>
  );
}

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
  onDone,
}: {
  campaigns: Campaign[];
  character: Character | null;
  defaultCampaignId: string;
  onDone: (character: Character) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

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
  const fileClass =
    "w-full text-sm text-stone-600 file:mr-3 file:rounded-md file:border-0 file:bg-stone-200 file:px-3 file:py-1.5 file:text-sm dark:text-stone-400 dark:file:bg-stone-800 dark:file:text-stone-200";

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" name="name" defaultValue={character?.name ?? ""} required />

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
          Character sheet {character ? "(leave empty to keep the current one)" : "(HTML file)"}
        </span>
        <input type="file" name="sheet" accept=".html,.htm,text/html" className={fileClass} />
        <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
          Sheets keep their own scripts and styling. They are displayed in an isolated frame, so
          they cannot interact with the rest of this app.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300">
          Background image (optional)
        </span>
        <input
          type="file"
          name="background"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className={fileClass}
        />
      </label>

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
function SessionRow({ session, onOpen }: { session: GameSession; onOpen: () => void }) {
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
      <Button onClick={onOpen}>Open console</Button>
    </div>
  );
}

export function GmLibrary({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [sessions, setSessions] = useState<GameSession[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [campaignDialog, setCampaignDialog] = useState<{ open: boolean; editing: Campaign | null }>(
    { open: false, editing: null },
  );
  const [characterDialog, setCharacterDialog] = useState<{
    open: boolean;
    editing: Character | null;
  }>({ open: false, editing: null });
  const [previewing, setPreviewing] = useState<Character | null>(null);

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

  const deleteCampaign = async (campaign: Campaign) => {
    if (
      !window.confirm(
        `Delete “${campaign.name}”? Its characters and sessions will be deleted too.`,
      )
    ) {
      return;
    }
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
    if (!window.confirm(`Delete “${character.name}”?`)) return;
    try {
      await api.delete(`/api/characters/${character.id}`);
      setCharacters((current) => current.filter((entry) => entry.id !== character.id));
      toast.show(`Deleted “${character.name}”.`, "success");
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
                />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="space-y-6 wide:grid wide:min-h-0 wide:flex-1 wide:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] wide:gap-6 wide:space-y-0">
        <Panel
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
            <div className={CARD_GRID}>
              {campaigns.map((campaign) => {
                const isSelected = campaign.id === selectedCampaignId;
                return (
                  <article
                    key={campaign.id}
                    className={`${CARD_BASE} ${
                      isSelected
                        ? "border-amber-500 ring-2 ring-amber-500/30"
                        : "border-stone-200 dark:border-stone-800"
                    } bg-white dark:bg-stone-900`}
                  >
                    <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-stone-200 dark:bg-stone-800">
                      <button
                        type="button"
                        onClick={() => setSelectedCampaignId(campaign.id)}
                        className="absolute inset-0 h-full w-full text-left"
                        aria-pressed={isSelected}
                        aria-label={`Select ${campaign.name}`}
                      >
                        {campaign.backgroundUrl ? (
                          <img
                            src={campaign.backgroundUrl}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 group-focus-within:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div
                            className="flex h-full items-center justify-center text-4xl opacity-30"
                            aria-hidden
                          >
                            📜
                          </div>
                        )}
                      </button>
                      <CardActions>
                        <IconButton
                          label={`Edit ${campaign.name}`}
                          icon={<EditIcon />}
                          onClick={() => setCampaignDialog({ open: true, editing: campaign })}
                        />
                        <IconButton
                          label={`Delete ${campaign.name}`}
                          icon={<DeleteIcon />}
                          danger
                          onClick={() => void deleteCampaign(campaign)}
                        />
                      </CardActions>
                    </div>

                    <div className="shrink-0 p-3">
                      <h3 className="truncate font-medium text-stone-900 dark:text-stone-100">
                        {campaign.name}
                      </h3>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Panel>

        {selectedCampaign ? (
          <Panel
            scroll
            title={`Characters in ${selectedCampaign.name}`}
            actions={
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => setCharacterDialog({ open: true, editing: null })}
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
                No characters in this campaign yet. Add one by uploading its HTML sheet.
              </EmptyState>
            ) : (
              <div className={CARD_GRID}>
                {visibleCharacters.map((character) => (
                  <CharacterCard
                    key={character.id}
                    character={character}
                    onOpen={() => setPreviewing(character)}
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
                          onClick={() => setCharacterDialog({ open: true, editing: character })}
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
          onClose={() => setCharacterDialog({ open: false, editing: null })}
        >
          <CharacterForm
            campaigns={campaigns}
            character={characterDialog.editing}
            defaultCampaignId={selectedCampaign.id}
            onDone={async () => {
              setCharacterDialog({ open: false, editing: null });
              await load();
            }}
          />
        </Modal>
      ) : null}

      {previewing ? (
        <Modal title={previewing.name} onClose={() => setPreviewing(null)} wide>
          <div className="h-[70vh] wide:h-[80vh]">
            <SheetFrame src={previewing.sheetUrl} title={previewing.name} />
          </div>
        </Modal>
      ) : null}
    </AppPage>
  );
}
