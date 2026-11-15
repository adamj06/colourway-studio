import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-24 sm:px-8">
      <h1 className="font-serif text-4xl">Page not found</h1>
      <p className="mt-4 text-lg text-muted">We couldn’t find the page you were looking for.</p>
      <p className="mt-8">
        <Link href="/" className="underline">
          Browse all designs
        </Link>
      </p>
    </main>
  );
}
