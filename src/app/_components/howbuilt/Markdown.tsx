import type { ReactNode } from 'react';
import type { Block, Inline } from '@/lib/markdown/parse';

// Everything here is a React element built from AST nodes: text goes in as text children, never as an HTML string.
// The parser has no html node and only emits allowlisted link hrefs, so repo Markdown cannot become markup.

export function Inlines({ nodes }: { nodes: readonly Inline[] }): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return (
          <code key={index} className="rounded bg-mat px-1 py-0.5 text-[0.9em] break-words">
            {node.value}
          </code>
        );
      case 'strong':
        return (
          <strong key={index}>
            <Inlines nodes={node.children} />
          </strong>
        );
      case 'em':
        return (
          <em key={index}>
            <Inlines nodes={node.children} />
          </em>
        );
      case 'link':
        return (
          <a key={index} href={node.href} rel="noopener noreferrer" className="underline">
            <Inlines nodes={node.children} />
          </a>
        );
    }
  });
}

const HEADING_CLASS = 'mt-6 mb-2 font-serif text-lg';

function Heading({ level, children }: { level: number; children: ReactNode }) {
  // Never above h6. The caller offsets levels so the heading outline stays under the item's own heading.
  const Tag = `h${String(Math.min(level, 6))}` as 'h2';
  return <Tag className={HEADING_CLASS}>{children}</Tag>;
}

function BlockView({ block, headingOffset }: { block: Block; headingOffset: number }) {
  switch (block.type) {
    case 'heading':
      return (
        <Heading level={block.level + headingOffset}>
          <Inlines nodes={block.children} />
        </Heading>
      );
    case 'paragraph':
      return (
        <p className="my-3 leading-relaxed">
          <Inlines nodes={block.children} />
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List className={`my-3 space-y-1 pl-6 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, index) => (
            <li key={index} className="leading-relaxed">
              <Inlines nodes={item} />
            </li>
          ))}
        </List>
      );
    }
    case 'code':
      return (
        <pre className="my-3 rounded bg-mat p-3 text-sm whitespace-pre-wrap break-words">
          <code>{block.value}</code>
        </pre>
      );
    case 'table':
      return (
        <table className="my-3 w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index} scope="col" className="border-b border-rule px-2 py-1 font-medium break-words">
                  <Inlines nodes={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index} className="border-b border-rule px-2 py-1 align-top break-words">
                    <Inlines nodes={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
  }
}

export function Markdown({ blocks, headingOffset = 0 }: { blocks: readonly Block[]; headingOffset?: number }) {
  return (
    <>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} headingOffset={headingOffset} />
      ))}
    </>
  );
}
