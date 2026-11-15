import { z } from 'zod';

// Schemas for the parts of the V&A v2 responses we use. Deliberately lenient about everything else: unknown fields
// are ignored, and fields the V&A is known to send as null, empty or not at all are optional. Field paths are
// taken from the captured responses in tests/fixtures/vam.

const searchRecordSchema = z.object({
  systemNumber: z.string().min(1),
  objectType: z.string().nullish(),
  _primaryTitle: z.string().nullish(),
  _primaryMaker: z.object({ name: z.string().nullish() }).nullish(),
  _primaryImageId: z.string().nullish(),
  _primaryDate: z.string().nullish(),
  _images: z.object({ _iiif_image_base_url: z.string().nullish() }).nullish(),
});

export const searchResponseSchema = z.object({
  info: z.object({
    record_count: z.number(),
    pages: z.number(),
    page: z.number(),
  }),
  records: z.array(searchRecordSchema).max(100),
});

const textRef = z.object({ text: z.string().nullish() }).nullish();
const makerSchema = z.object({ name: textRef, association: textRef });

export const objectResponseSchema = z.object({
  meta: z.object({
    images: z.object({ _iiif_image: z.string().nullish() }).nullish(),
    _links: z.object({ collection_page: z.object({ href: z.string().nullish() }).nullish() }).nullish(),
  }),
  record: z.object({
    systemNumber: z.string().min(1),
    objectType: z.string().nullish(),
    titles: z.array(z.object({ title: z.string().nullish() })).default([]),
    summaryDescription: z.string().nullish(),
    materialsAndTechniques: z.string().nullish(),
    creditLine: z.string().nullish(),
    artistMakerPerson: z.array(makerSchema).default([]),
    artistMakerOrganisations: z.array(makerSchema).default([]),
    dimensions: z
      .array(z.object({ dimension: z.string().nullish(), value: z.string().nullish(), unit: z.string().nullish() }))
      .default([]),
    productionDates: z.array(z.object({ date: z.object({ text: z.string().nullish() }).nullish() })).default([]),
    images: z.array(z.string()).max(500).default([]),
  }),
});

export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ObjectResponse = z.infer<typeof objectResponseSchema>;
