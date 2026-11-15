import Link from 'next/link';

export default function DesignNotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-24 sm:px-8">
      <h1 className="font-serif text-4xl">We couldn’t find that design</h1>
      <p className="mt-4 text-lg text-muted">The link may be wrong, or the design is no longer in the collection.</p>
      <p className="mt-8">
        <Link href="/" className="underline">
          ← All designs
        </Link>
      </p>
    </main>
  );
}
