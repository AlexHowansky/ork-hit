/**
 * Displays an uploaded character sheet.
 *
 * The sheet is the game master's own HTML and keeps its JavaScript, so it is
 * loaded in an iframe with `sandbox` and deliberately *without*
 * `allow-same-origin`. That puts it in an opaque origin: its scripts still run,
 * but it cannot read this page's cookies or storage, reach into the DOM around
 * it, or call the API as the signed-in user. The response carries the same
 * sandbox as a header, so the restriction does not depend on this attribute
 * alone.
 */

export function SheetFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={`${title} — character sheet`}
      // allow-scripts without allow-same-origin is the isolation boundary.
      // allow-forms and allow-popups let an interactive sheet behave normally.
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="h-full w-full rounded-lg border border-stone-200 bg-white dark:border-stone-800"
    />
  );
}
