import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { publicUrl } from "@/lib/paths";
import { cn } from "@/lib/utils";

function shotHref(url: string): string {
  return url.startsWith("/") ? publicUrl(url) : url;
}

export function Shot({
  url,
  alt,
  onOpen,
  className,
  imgClassName,
}: {
  url: string;
  alt: string;
  onOpen: (url: string) => void;
  className?: string;
  imgClassName?: string;
}) {
  const href = shotHref(url);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  if (failedFor === href) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(href)}
      className={cn("mt-2 block cursor-zoom-in overflow-hidden rounded-md border border-border bg-zinc-950 text-left", className)}
    >
      <img
        key={href}
        src={href}
        alt={alt}
        loading="lazy"
        className={cn("max-h-40 w-full object-cover object-top", imgClassName)}
        onError={() => setFailedFor(href)}
      />
    </button>
  );
}

export function ShotPreview({
  url,
  alt = "Screenshot",
  description = "Captured screenshot.",
  onOpenChange,
}: {
  url: string | null;
  alt?: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(url)} onOpenChange={onOpenChange}>
      <SheetContent
        className="z-[60] w-full sm:max-w-3xl"
        overlayClassName="z-[60]"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onPointerDownOutside={(event) => event.stopPropagation()}
        onInteractOutside={(event) => event.stopPropagation()}
      >
        <SheetHeader>
          <SheetTitle>Screenshot</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {url ? (
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            <img src={url} alt={alt} className="w-full rounded-md border border-border" />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
