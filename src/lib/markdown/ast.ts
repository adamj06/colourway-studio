/**
 * The Markdown subset the "How this was built" page renders. There is deliberately no `html` node:
 * raw HTML in the source is kept as literal text, so nothing here can become markup.
 */
export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] };
