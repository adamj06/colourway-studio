import type { FrictionEntry } from '@/lib/howbuilt/friction';
import { parseInline } from '@/lib/markdown/parse';
import { Inlines } from './Markdown';

const FIELDS: readonly { label: string; key: 'doing' | 'wentWrong' | 'resolvedBy' | 'prevention' | 'caughtBy' }[] = [
  { label: 'Doing', key: 'doing' },
  { label: 'What went wrong', key: 'wentWrong' },
  { label: 'Resolved by', key: 'resolvedBy' },
  { label: 'Prevention', key: 'prevention' },
  { label: 'Caught by', key: 'caughtBy' },
];

export function CaughtByTable({ tally }: { tally: readonly { who: string; count: number }[] }) {
  return (
    <table className="mt-4 w-full max-w-md border-collapse text-left text-sm">
      <caption className="pb-2 text-left text-muted">Who caught each problem</caption>
      <thead>
        <tr>
          <th scope="col" className="border-b border-rule py-1 pr-4 font-medium">
            Caught by
          </th>
          <th scope="col" className="border-b border-rule py-1 text-right font-medium">
            Entries
          </th>
        </tr>
      </thead>
      <tbody>
        {tally.map((row) => (
          <tr key={row.who}>
            <td className="border-b border-rule py-1 pr-4 break-words">{row.who}</td>
            <td className="border-b border-rule py-1 text-right tabular-nums">{row.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FrictionList({ entries }: { entries: readonly FrictionEntry[] }) {
  return (
    <ul className="mt-6">
      {entries.map((entry, index) => (
        <li key={`${entry.timestamp}-${String(index)}`} className="border-t border-rule py-3">
          <details>
            <summary className="cursor-pointer">
              <h3 className="inline font-serif text-lg">{entry.title}</h3>
              <span className="ml-3 text-sm text-muted">{entry.timestamp}</span>
            </summary>
            <dl className="mt-2 max-w-3xl space-y-2 leading-relaxed">
              {FIELDS.filter(({ key }) => entry[key] !== '').map(({ label, key }) => (
                <div key={key}>
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd>
                    <Inlines nodes={parseInline(entry[key])} />
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}
