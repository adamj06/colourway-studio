import Link from 'next/link';
import type { DesignSummary } from '@/lib/vam/types';
import { DesignImage } from './DesignImage';

/** One design in the grid. The link's accessible name is the visible text, so the image is decorative (alt=""). */
export function DesignCard({ design }: { design: DesignSummary }) {
  const byline = [design.designer, design.date].filter(Boolean).join(' · ');
  return (
    <li>
      <Link href={`/design/${design.systemNumber}`} className="group block no-underline">
        <div className="aspect-square overflow-hidden bg-mat">
          <DesignImage
            imageBaseUrl={design.imageBaseUrl}
            size={400}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        </div>
        <h3 className="mt-3 font-serif text-lg leading-snug text-foreground group-hover:underline">{design.title}</h3>
        {byline ? <p className="mt-0.5 text-sm text-muted">{byline}</p> : null}
      </Link>
    </li>
  );
}
