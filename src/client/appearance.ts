/**
 * Pulls in the deployment's own settings — currently just how large a card's
 * picture is drawn.
 *
 * The value lives in the server's environment, and this client is a bundle built
 * when the server starts, so it cannot be compiled in. It arrives as a stylesheet
 * (`/appearance.css`) rather than as JSON: a custom property is what the layout
 * reads, so nothing has to re-render when it lands, and there is no state to
 * thread through the app.
 *
 * The link is attached here rather than written into `index.html` because the
 * bundler resolves the document's links at build time, and this one only exists
 * at run time. `styles.css` declares the same property with the default, so a
 * page whose request for this is slow — or fails — is laid out correctly
 * throughout, at the standard size.
 */
export function loadAppearance(): void {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/appearance.css";
  document.head.appendChild(link);
}
