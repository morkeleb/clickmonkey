/** Quality messages often contain `<style>` / `<div>`; raw HTML tokens eat the rest of the report. */
export function escapeHtmlToken(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
