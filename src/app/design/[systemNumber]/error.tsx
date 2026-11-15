'use client';

import Link from 'next/link';

export default function DesignError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-24 sm:px-8">
      <h1 className="font-serif text-4xl">We couldn’t show this design</h1>
      <p className="mt-4 text-lg text-muted">Something went wrong while loading it. Please try again.</p>
      <p className="mt-8 flex gap-6">
        <button type="button" onClick={reset} className="border border-foreground px-6 py-2.5 text-sm tracking-wide">
          Try again
        </button>
        <Link href="/" className="self-center underline">
          ← All designs
        </Link>
      </p>
    </main>
  );
}
