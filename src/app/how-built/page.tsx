import type { Metadata } from 'next';
import { loadHowBuilt } from '@/server/howbuilt-data';
import { AdrList } from '../_components/howbuilt/AdrList';
import { BuildLogList } from '../_components/howbuilt/BuildLogList';
import { CostTable } from '../_components/howbuilt/CostTable';
import { CaughtByTable, FrictionList } from '../_components/howbuilt/FrictionList';

export const metadata: Metadata = {
  title: 'How this was built',
  description:
    'The build log, architecture decisions, friction log and cost of building Colourway Studio with Claude Code.',
};

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-16">
      <h2 id={id} className="font-serif text-3xl">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-muted">{intro}</p>
      {children}
    </section>
  );
}

// Reads the repo's own build record when the site is built, so the page is static and ships no client JS.
// An invalid source throws here, which fails the build instead of publishing a half-rendered page.
export default function HowBuiltPage() {
  const data = loadHowBuilt();
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-14 sm:px-8">
      <h1 className="max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">How this was built</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
        Colourway Studio was built feature by feature with Claude Code. This page is generated from the project&rsquo;s
        own records, including the things that went wrong.
      </p>

      <Section id="build-log" title="Build log" intro="One entry per feature, in the order they were built.">
        <BuildLogList entries={data.buildLog} />
      </Section>
      <Section id="decisions" title="Decisions" intro="Architecture decision records. Open one to read it.">
        <AdrList adrs={data.adrs} />
      </Section>
      <Section
        id="friction"
        title="Friction log"
        intro="Where the agent or the tooling got in the way, written at the time, newest first."
      >
        <CaughtByTable tally={data.frictionTally} />
        <FrictionList entries={data.friction} />
      </Section>
      <Section id="cost" title="Cost" intro="What the sessions cost, from the token ledger.">
        <CostTable summary={data.cost.summary} skipped={data.cost.skipped} />
      </Section>
    </main>
  );
}
