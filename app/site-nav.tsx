import Link from "next/link";
import { HagglMark } from "./haggl-mark";

export function SiteNav({ here }: { here: "home" | "live" }) {
  return (
    <header className="sticky top-0 z-10 border-b border-white/10 bg-ink text-white">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <HagglMark />
          <span className="text-sm font-semibold tracking-tight">Haggl</span>
        </Link>
        {here === "live" ? (
          <span className="text-sm text-white/70">Live run</span>
        ) : (
          <Link
            href="/live"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Live run
          </Link>
        )}
      </div>
    </header>
  );
}
