import { formatCount, formatUsd } from '@/lib/howbuilt/format';
import type { CostSummary, Totals } from '@/lib/howbuilt/ledger';

function GroupTable({
  caption,
  label,
  rows,
}: {
  caption: string;
  label: string;
  rows: readonly ({ name: string } & Totals)[];
}) {
  return (
    <table className="mt-6 w-full border-collapse text-left text-sm">
      <caption className="pb-2 text-left text-muted">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="border-b border-rule py-1 pr-4 font-medium">
            {label}
          </th>
          <th scope="col" className="border-b border-rule py-1 pr-4 text-right font-medium">
            Est. cost
          </th>
          <th scope="col" className="border-b border-rule py-1 pr-4 text-right font-medium">
            Output tokens
          </th>
          <th scope="col" className="border-b border-rule py-1 text-right font-medium">
            Sessions
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th scope="row" className="border-b border-rule py-1 pr-4 font-normal break-words">
              {row.name}
            </th>
            <td className="border-b border-rule py-1 pr-4 text-right tabular-nums">{formatUsd(row.usd)}</td>
            <td className="border-b border-rule py-1 pr-4 text-right tabular-nums">{formatCount(row.outputTokens)}</td>
            <td className="border-b border-rule py-1 text-right tabular-nums">{formatCount(row.sessions)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CostTable({ summary, skipped }: { summary: CostSummary; skipped: number }) {
  const { total } = summary;
  return (
    <div>
      <p className="mt-4 max-w-3xl text-lg leading-relaxed">
        <strong>{formatUsd(total.usd)}</strong> estimated across {formatCount(total.sessions)} sessions and{' '}
        {formatCount(total.outputTokens)} output tokens.
      </p>
      <GroupTable
        caption="Estimated cost by branch"
        label="Branch"
        rows={summary.byBranch.map(({ branch, ...totals }) => ({ name: branch, ...totals }))}
      />
      <GroupTable
        caption="Estimated cost by model"
        label="Model"
        rows={summary.byModel.map(({ model, ...totals }) => ({ name: model, ...totals }))}
      />
      <p className="mt-4 text-sm text-muted">
        Estimates from token counts, logged automatically at the end of each session.
        {skipped > 0
          ? ` ${String(skipped)} ledger ${skipped === 1 ? 'row was' : 'rows were'} unreadable and skipped.`
          : ''}
      </p>
    </div>
  );
}
