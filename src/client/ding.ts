/**
 * The turn chime.
 *
 * Synthesised with the Web Audio API rather than shipped as a file: it needs no
 * asset, no network round trip, and nothing to add to the page's CSP.
 *
 * Browsers refuse to start audio for a page the user has never interacted with.
 * A player has always clicked their way in by the time a turn can reach them, so
 * in practice this plays — but every step is best effort, and a browser that says
 * no simply leaves the toast to do the telling.
 */

let context: AudioContext | null = null;

/** One AudioContext for the tab; creating one per chime would leak them. */
function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** A two-note chime, quiet enough not to startle a table. */
export async function playDing(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;

  try {
    // Created before a gesture, a context starts suspended; resuming is allowed
    // once the user has interacted with the page at all.
    if (ctx.state === "suspended") await ctx.resume();
    if (ctx.state !== "running") return;

    const start = ctx.currentTime;
    // A fifth apart, the second following the first: a doorbell, not an alarm.
    for (const [offset, frequency] of [
      [0, 880],
      [0.12, 1320],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = frequency;

      // Ramped rather than switched, because a square-edged gain change clicks.
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.45);

      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.5);
    }
  } catch {
    // Autoplay policy, a closed context, a browser without oscillators: none of
    // them are worth interrupting the game over.
  }
}
