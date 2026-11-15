'use client';

import Link from 'next/link';

// Never render error.message: it can contain internals. Next logs the digest on the server for us.
export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-24 sm:px-8">
      <h1 className="font-serif text-4xl">Something went wrong</h1>
      <p className="mt-4 text-lg text-muted">We hit a problem showing this page. It’s not you; please try again.</p>
      <p className="mt-8 flex gap-6">
        <button type="button" onClick={reset} className="border border-foreground px-6 py-2.5 text-sm tracking-wide">
          Try again
        </button>
        <Link href="/" className="self-center underline">
          Back to all designs
        </Link>
      </p>
    </main>
  );
}
