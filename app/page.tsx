import Link from "next/link";
import { HagglMark } from "./haggl-mark";
import { SiteNav } from "./site-nav";

const STEPS = [
  {
    title: "Listings for that product",
    body: "You already know what you want. Haggl finds the real listings for it. The live run trials one product with three sellers: a refurbished iPhone 14 on Back Market, Reebelo, and Swappa.",
  },
  {
    title: "One agent per seller",
    body: "Each seller gets its own agent and a price floor it will not cross. The agent can drop the price or hold. It cannot invent a warranty. Add more sellers and each one gets an agent.",
  },
  {
    title: "A buyer talks to every seller",
    body: "The buyer presses them at the same time, using the other listings as the comparison. A hold ends that conversation.",
  },
  {
    title: "You get one scored deal",
    body: "Cheapest, best condition, longest warranty, or balanced. The winner comes with a one-line reason, and nothing is purchased until you confirm.",
  },
];

export default function Home() {
  return (
    <div className="min-h-full text-ink">
      <SiteNav here="home" />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-16 px-6 py-16">
        <header className="max-w-xl space-y-5">
          <HagglMark className="h-11 w-11" />
          <h1 className="offer-type text-5xl font-medium leading-tight tracking-tight">
            Sellers compete. You choose the deal.
          </h1>
          <p className="text-base leading-relaxed text-mute">
            Haggl is a reverse auction for a purchase you already want. Name a
            product and the sellers who list it compete at the same time on
            price, condition, and warranty. It is not a phone app, and it is
            not limited to three sellers. The live run is one trial: a
            refurbished iPhone 14, with three sellers.
          </p>
          <Link
            href="/live"
            className="inline-flex h-12 w-fit items-center rounded-md bg-accent px-5 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Live run
          </Link>
        </header>

        <section className="space-y-6">
          <h2 className="text-sm font-semibold text-ink">How it works</h2>
          <ol className="grid gap-6 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <li key={step.title} className="border-t border-line pt-4">
                <p className="text-sm font-semibold text-accent">0{i + 1}</p>
                <h3 className="mt-1 text-base font-semibold text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="max-w-xl space-y-3 border-t border-line pt-8">
          <h2 className="text-sm font-semibold text-ink">What it is for</h2>
          <p className="text-sm leading-relaxed text-mute">
            Any product, and as many sellers as you have listings for. The
            phone in the live run is only the product we chose to trial. Run
            the same listings under two priorities and the winner can change.
            That is the point: the result is a tradeoff, not a price sort.
          </p>
          <p className="text-sm leading-relaxed text-mute">
            Haggl does not decide what to buy. It improves the deal once you
            know. You confirm the purchase yourself. If a seller fails, the
            card shows the listed terms and says so. No payment is taken.
          </p>
        </section>
      </main>
    </div>
  );
}
