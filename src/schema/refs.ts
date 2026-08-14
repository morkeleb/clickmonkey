export function widgetKey(surfaceId: string, id: string): string {
  return `${surfaceId}.${id}`;
}

export function readyKey(pageId: string): string {
  return `page:${pageId}.ready`;
}
