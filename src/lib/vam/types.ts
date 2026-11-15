// Our own domain types. No V&A field names leak past src/lib/vam.

export type DesignSummary = {
  systemNumber: string;
  title: string;
  designer: string | null;
  date: string | null;
  objectType: string;
  /** https://framemark.vam.ac.uk/collections/<id>/ : pass to iiifImageUrl for a sized image. */
  imageBaseUrl: string;
};

export type Design = {
  systemNumber: string;
  title: string;
  designers: string[];
  manufacturers: string[];
  date: string | null;
  objectType: string;
  materials: string | null;
  dimensions: string | null;
  /** Plain text. Paragraphs are separated by a blank line. */
  description: string | null;
  imageBaseUrl: string;
  creditLine: string | null;
  collectionUrl: string | null;
};

export type SearchResult = {
  items: DesignSummary[];
  page: number;
  totalPages: number;
  total: number;
};
