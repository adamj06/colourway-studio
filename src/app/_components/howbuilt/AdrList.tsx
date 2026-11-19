import type { Adr } from '@/lib/howbuilt/adr';
import { parseMarkdown } from '@/lib/markdown/parse';
import { Markdown } from './Markdown';

export function AdrList({ adrs }: { adrs: readonly Adr[] }) {
  return (
    <ul className="mt-4">
      {adrs.map((adr) => (
        <li key={adr.number} className="border-t border-rule py-4">
          <details>
            <summary className="cursor-pointer">
              <h3 className="inline font-serif text-xl">
                ADR {String(adr.number).padStart(4, '0')}: {adr.title}
              </h3>
              <span className="ml-3 text-sm text-muted">
                {adr.status} · {adr.date}
              </span>
            </summary>
            <div className="mt-2 max-w-3xl">
              {/* ADR bodies use ## for their sections, which sit under this item's h3 as h4. */}
              <Markdown blocks={parseMarkdown(adr.body)} headingOffset={2} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
