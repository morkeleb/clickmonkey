/** True when a click target is a report screenshot (img or a link to one). */
export function looksLikeShotHref(href: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, "http://local.invalid");
    return /\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname) || url.pathname.includes("/files/");
  } catch {
    return /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(href) || href.includes("/files/");
  }
}

export function shotFromClick(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const img = target.closest("img");
  if (img instanceof HTMLImageElement && img.src) return img.src;
  const anchor = target.closest("a");
  if (anchor instanceof HTMLAnchorElement && looksLikeShotHref(anchor.href)) return anchor.href;
  return null;
}
