import { Suspense } from 'react';
import { Browse } from './_components/Browse';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-14 sm:px-8">
      <h1 className="max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">Morris &amp; Co. designs</h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted">
        Wallpapers and textiles from the V&amp;A collection. Pick one to look closely.
      </p>
      <div className="mt-10">
        {/* Browse reads ?q= on the client, which needs a Suspense boundary with Cache Components. */}
        <Suspense fallback={<p className="text-sm text-muted">Loading designs…</p>}>
          <Browse />
        </Suspense>
      </div>
    </main>
  );
}
