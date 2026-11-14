/** Save text as a file in the browser. The object URL is revoked later, since revoking right away can cancel the download. */
export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Attached while clicked: some browsers (older Firefox) ignore a click on a link that isn't in the page.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
