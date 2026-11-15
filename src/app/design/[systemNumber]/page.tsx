import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { parseSystemNumber } from '@/lib/api/params';
import { DesignDetail } from '../../_components/DesignDetail';

export default function DesignPage({ params }: PageProps<'/design/[systemNumber]'>) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8">
      {/* `params` is request data, so it is read under Suspense (Cache Components). */}
      <Suspense fallback={<p role="status">Loading design…</p>}>
        <Content params={params} />
      </Suspense>
    </main>
  );
}

async function Content({ params }: { params: PageProps<'/design/[systemNumber]'>['params'] }) {
  const parsed = parseSystemNumber((await params).systemNumber);
  // A malformed id can never be a design: skip the API call and show the not-found page.
  if (!parsed.ok) notFound();
  return <DesignDetail systemNumber={parsed.value} />;
}
