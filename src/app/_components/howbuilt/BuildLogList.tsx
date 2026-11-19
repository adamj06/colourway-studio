import type { BuildLogEntry } from '@/lib/howbuilt/buildLog';

function Tags({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <dt className="text-muted">{label}</dt>
      {values.map((value, index) => (
        <dd key={`${String(index)}-${value}`} className="rounded bg-mat px-2 py-0.5 text-sm">
          {value}
        </dd>
      ))}
    </div>
  );
}

function Entry({ entry }: { entry: BuildLogEntry }) {
  return (
    <li className="border-t border-rule py-6">
      <h3 className="font-serif text-2xl">{entry.title}</h3>
      <p className="mt-1 text-sm text-muted">
        <time dateTime={entry.date}>{entry.date}</time> · {entry.id}
        {entry.prUrl ? (
          <>
            {' · '}
            <a href={entry.prUrl} rel="noopener noreferrer" className="underline">
              Pull request
            </a>
          </>
        ) : null}
      </p>
      <p className="mt-3 max-w-3xl leading-relaxed">{entry.summary}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <Tags label="Models" values={entry.models} />
        <Tags label="Subagents" values={entry.subagents} />
        <div className="flex gap-2">
          <dt className="text-muted">Review findings fixed</dt>
          <dd>{entry.reviewFindingsFixed}</dd>
        </div>
      </dl>
      {entry.humanInterventions.length > 0 ? (
        <details className="mt-4 max-w-3xl">
          <summary className="cursor-pointer text-sm underline">
            Where the human steered ({entry.humanInterventions.length})
          </summary>
          <ul className="mt-2 list-disc space-y-2 pl-6 leading-relaxed">
            {entry.humanInterventions.map((text, index) => (
              <li key={`${String(index)}-${text}`}>{text}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export function BuildLogList({ entries }: { entries: readonly BuildLogEntry[] }) {
  return (
    <ol className="mt-4">
      {entries.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </ol>
  );
}
