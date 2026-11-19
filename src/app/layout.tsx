import type { Metadata } from 'next';
import { EB_Garamond, Geist } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const sans = Geist({ variable: '--font-sans-stack', subsets: ['latin'] });
const serif = EB_Garamond({ variable: '--font-serif-stack', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Colourway Studio', template: '%s · Colourway Studio' },
  description: 'Explore Morris & Co. designs from the V&A collection, and soon recolour them into new colourways.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 pt-8 sm:px-8">
          <Link href="/" className="font-serif text-2xl tracking-wide text-foreground no-underline">
            Colourway Studio
          </Link>
          <nav aria-label="Site">
            <Link href="/how-built" className="text-sm text-muted underline">
              How this was built
            </Link>
          </nav>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="mx-auto w-full max-w-6xl border-t border-rule px-5 py-8 text-sm text-muted sm:px-8">
          <p>
            Images © Victoria and Albert Museum, London, from the{' '}
            <a className="underline" href="https://collections.vam.ac.uk/">
              V&amp;A collections
            </a>
            . A personal case-study project, not affiliated with Sanderson Design Group or Morris &amp; Co.
          </p>
        </footer>
      </body>
    </html>
  );
}
