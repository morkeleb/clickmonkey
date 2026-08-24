import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

type ShotOpen = (url: string, alt?: string) => void;

const ShotCtx = createContext<ShotOpen | null>(null);

/** Open the shared lightbox. Report HTML clicks use this; thumbs use `<Shot>`. */
export function useOpenShot(): ShotOpen {
  const open = useContext(ShotCtx);
  return useCallback(
    (url: string, alt?: string) => {
      open?.(shotHref(url), alt);
    },
    [open],
  );
}

function Lightbox({
  url,
  alt,
  onOpenChange,
}: {
  url: string | null;
  alt: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [url]);
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
          <SheetDescription>{alt}</SheetDescription>
        </SheetHeader>
        {url ? (
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
            <span className="relative block h-[min(70vh,28rem)] w-full overflow-hidden rounded-md border border-border bg-zinc-950">
              {!loaded ? <span className="absolute inset-0 animate-pulse bg-zinc-700/80" aria-hidden /> : null}
              <img
                src={url}
                alt={alt}
                className={cn("relative h-full w-full object-contain object-top", loaded ? "opacity-100" : "opacity-0")}
                onLoad={() => setLoaded(true)}
              />
            </span>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** One lightbox for the app. Put this around the UI; `<Shot>` and `useOpenShot` share it. */
export function ShotHost({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<{ url: string; alt: string } | null>(null);
  const open = useCallback<ShotOpen>((url, alt) => {
    setPreview({ url: shotHref(url), alt: alt ?? "Screenshot" });
  }, []);
  return (
    <ShotCtx.Provider value={open}>
      {children}
      <Lightbox
        url={preview?.url ?? null}
        alt={preview?.alt ?? "Screenshot"}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </ShotCtx.Provider>
  );
}

function Pulse({ className }: { className?: string }) {
  return <span className={cn("absolute inset-0 animate-pulse bg-zinc-700/80", className)} aria-hidden />;
}

/** Empty reserved frame for tape/findings/report loading rows. */
export function ShotSkeleton({ className, frameClassName }: { className?: string; frameClassName?: string }) {
  return (
    <span className={cn("mt-2 block min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-zinc-950", className)}>
      <span className={cn("relative block h-40 w-full overflow-hidden", frameClassName)}>
        <Pulse />
      </span>
    </span>
  );
}

export function Shot({
  url,
  alt,
  className,
  frameClassName,
  fit = "cover",
}: {
  url: string;
  alt: string;
  className?: string;
  frameClassName?: string;
  /** `thumb` = scaled-down page (tape). `contain` = full page in the frame (findings). `cover` = top crop. */
  fit?: "cover" | "contain" | "thumb";
}) {
  const href = shotHref(url);
  const openHost = useContext(ShotCtx);
  const [local, setLocal] = useState(false);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const thumb = fit === "thumb";
  useEffect(() => {
    setLoaded(false);
  }, [href]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.closest("[data-slot=scroll-area-viewport]");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { root: root instanceof Element ? root : null, rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [href]);
  const failed = failedFor === href;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => {
          if (openHost) openHost(href, alt);
          else setLocal(true);
        }}
        className={cn(
          "mt-2 block min-w-0 cursor-zoom-in overflow-hidden rounded-md border border-border text-left",
          thumb ? "w-full max-w-md" : "w-full max-w-full",
          className,
        )}
      >
        <span
          className={cn(
            "relative block min-w-0 overflow-hidden bg-zinc-950",
            thumb ? "h-56 w-full" : "h-40 w-full",
            frameClassName,
          )}
        >
          {!loaded && !failed ? <Pulse /> : null}
          {failed ? <span className="absolute inset-0 bg-zinc-900" aria-hidden /> : null}
          {inView && !failed ? (
            <img
              key={href}
              src={href}
              alt={alt}
              className={cn(
                "max-w-full object-top",
                thumb
                  ? "relative block h-auto w-full"
                  : cn(
                      "absolute inset-0 h-full w-full",
                      fit === "contain" ? "object-contain" : "object-cover",
                    ),
                loaded ? "opacity-100" : "opacity-0",
              )}
              onLoad={() => setLoaded(true)}
              onError={() => setFailedFor(href)}
            />
          ) : null}
        </span>
      </button>
      {openHost ? null : (
        <Lightbox
          url={local ? href : null}
          alt={alt}
          onOpenChange={(open) => {
            if (!open) setLocal(false);
          }}
        />
      )}
    </>
  );
}
