import type { Route } from "./helpers.js";

export const wikiSearch = {
  continue: { sroffset: 2 },
  query: {
    searchinfo: { totalhits: 120 },
    search: [
      { title: "Fotosíntesis", snippet: 'La <span class="searchmatch">fotosíntesis</span> es un proceso', timestamp: "2026-10-01T10:00:00Z" },
      { title: "Clorofila", snippet: "Pigmento verde", timestamp: "2026-09-01T10:00:00Z" },
    ],
  },
};

export const wikiArticle = {
  query: {
    pages: [
      {
        pageid: 1,
        title: "Fotosíntesis",
        fullurl: "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis",
        extract: "La fotosíntesis es la conversión de materia inorgánica en materia orgánica gracias a la energía de la luz.\n\nHistoria\nTexto adicional del artículo.",
        revisions: [{ timestamp: "2026-10-01T10:00:00Z" }],
      },
    ],
  },
};

export const wikiGenerator = {
  query: {
    pages: [
      { index: 2, title: "Clorofila", fullurl: "https://es.wikipedia.org/wiki/Clorofila", extract: "La clorofila es un pigmento.", revisions: [{ timestamp: "2026-09-01T00:00:00Z" }] },
      { index: 1, title: "Fotosíntesis", fullurl: "https://es.wikipedia.org/wiki/Fotos%C3%ADntesis", extract: "La fotosíntesis convierte luz en energía química en plantas.", revisions: [{ timestamp: "2026-10-01T00:00:00Z" }] },
    ],
  },
};

export const wikidataSearch = { search: [{ id: "Q298" }] };
export const wikidataEntities = {
  entities: {
    Q298: {
      id: "Q298",
      modified: "2026-10-10T00:00:00Z",
      labels: { es: { value: "Chile" } },
      descriptions: { es: { value: "país de América del Sur" } },
      sitelinks: { eswiki: { url: "https://es.wikipedia.org/wiki/Chile" } },
      claims: {
        P36: [{ rank: "normal", mainsnak: { datavalue: { type: "wikibase-entityid", value: { id: "Q2887" } } }, references: [{}] }],
        P1082: [
          {
            rank: "preferred",
            mainsnak: { datavalue: { type: "quantity", value: { amount: "+19960889", unit: "1" } } },
            qualifiers: { P585: [{ datavalue: { type: "time", value: { time: "+2024-00-00T00:00:00Z", precision: 9 } } }] },
            references: [{}],
          },
        ],
      },
    },
  },
};
export const wikidataLabels = { entities: { Q2887: { labels: { es: { value: "Santiago de Chile" } } }, P36: { labels: { es: { value: "capital" } } }, P1082: { labels: { es: { value: "población" } } } } };

export const openalexWork = {
  id: "https://openalex.org/W100",
  doi: "https://doi.org/10.1000/ABC.1",
  display_name: "Photosynthesis efficiency in crops",
  publication_date: "2023-04-01",
  type: "article",
  cited_by_count: 42,
  is_retracted: false,
  primary_location: { source: { display_name: "Nature Plants", type: "journal" } },
  authorships: [{ author: { display_name: "Ana Pérez" } }],
  abstract_inverted_index: { Photosynthesis: [0], drives: [1], growth: [2] },
  referenced_works: ["https://openalex.org/W1"],
  related_works: ["https://openalex.org/W200"],
};
export const openalexSearch = { meta: { count: 1 }, results: [openalexWork] };
export const openalexRelated = {
  results: [{ ...openalexWork, id: "https://openalex.org/W200", doi: null, display_name: "Related crop study", type: "preprint", primary_location: { source: { type: "repository", display_name: "bioRxiv" } } }],
};

export const crossrefItem = {
  DOI: "10.1000/XYZ.9",
  title: ["Chlorophyll <i>review</i>"],
  author: [{ given: "Luis", family: "Soto" }],
  published: { "date-parts": [[2021, 3, 5]] },
  type: "journal-article",
  "container-title": ["Plant Journal"],
  "is-referenced-by-count": 7,
  abstract: "<jats:p>Chlorophyll absorbs light.</jats:p>",
};

export const pubmedSearch = { esearchresult: { count: "1", idlist: ["12345"] } };
export const pubmedSummary = {
  result: {
    uids: ["12345"],
    "12345": { uid: "12345", title: "Vitamin D and bone health", sortpubdate: "2020/01/15 00:00", authors: [{ name: "Smith J" }], fulljournalname: "BMJ", articleids: [{ idtype: "doi", value: "10.1136/bmj.1" }], pubtype: ["Journal Article"] },
  },
};
export const pubmedXml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><Article><Abstract>
<AbstractText Label="BACKGROUND">Vitamin D matters.</AbstractText><AbstractText Label="RESULTS">Bones <i>improved</i>.</AbstractText>
</Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`;

export const arxivXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults>1</opensearch:totalResults>
<entry><id>http://arxiv.org/abs/2101.00001v2</id><updated>2021-02-01T00:00:00Z</updated><published>2021-01-01T00:00:00Z</published>
<title>Attention for
 photosynthesis models</title><summary>We model photosynthesis with transformers.</summary>
<author><name>A. Researcher</name></author><arxiv:primary_category term="cs.LG"/></entry></feed>`;

export const wbIndicatorData = [
  { page: 1, pages: 1, total: 2, lastupdated: "2026-07-01" },
  [
    { indicator: { id: "NY.GDP.PCAP.CD", value: "GDP per capita (current US$)" }, country: { id: "CL", value: "Chile" }, countryiso3code: "CHL", date: "2023", value: 17000.5, unit: "" },
    { indicator: { id: "NY.GDP.PCAP.CD", value: "GDP per capita (current US$)" }, country: { id: "CL", value: "Chile" }, countryiso3code: "CHL", date: "2022", value: 15300.1, unit: "" },
  ],
];
export const wbIndicators = [
  { page: 1 },
  [
    { id: "NY.GDP.PCAP.CD", name: "GDP per capita (current US$)", sourceNote: "GDP per capita is gross domestic product divided by midyear population.", sourceOrganization: "World Bank" },
    { id: "SP.POP.TOTL", name: "Population, total", sourceNote: "Total population counts all residents." },
  ],
];

export const ghRepo = {
  full_name: "acme/mcp-kit",
  description: "Toolkit MCP",
  html_url: "https://github.com/acme/mcp-kit",
  stargazers_count: 1500,
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  archived: false,
  created_at: "2024-01-01T00:00:00Z",
  pushed_at: "2026-11-01T00:00:00Z",
  default_branch: "main",
  open_issues_count: 3,
};

export const html = `<html lang="es"><head><title>Informe oficial</title><meta name="description" content="Resumen del informe">
<meta property="article:published_time" content="2025-06-01"></head><body><nav>x</nav><main><h1>Informe</h1><p>La tasa fue 5,2%.</p></main></body></html>`;

export const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Noticias Gob</title><lastBuildDate>Mon, 10 Nov 2026 10:00:00 GMT</lastBuildDate>
<item><title>Nueva ley</title><link>https://www.gob.cl/noticias/ley</link><description>&lt;p&gt;Se aprobó la ley.&lt;/p&gt;</description><pubDate>Mon, 10 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>Otra</title><link>https://www.gob.cl/noticias/otra</link><description>Texto</description><pubDate>Sun, 09 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;
export const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><updated>2026-11-01T00:00:00Z</updated>
<entry><title>v2.0</title><link rel="alternate" href="https://example.org/v2"/><updated>2026-11-01T00:00:00Z</updated><summary>Major release</summary><author><name>Equipo</name></author></entry></feed>`;

/** Minimal valid one-page PDF containing the text "Hola PDF". */
export function tinyPdf(): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = "BT /F1 18 Tf 20 100 Td (Hola PDF) Tj ET";
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o ?? `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/** Default routes for every public source, so `investigar` can run end-to-end offline. */
export const publicRoutes: Route[] = [
  [/wikipedia\.org\/w\/api\.php.*generator=search/, { body: wikiGenerator }],
  [/wikipedia\.org\/w\/api\.php.*list=search/, { body: wikiSearch }],
  [/wikipedia\.org\/w\/api\.php.*prop=extracts/, { body: wikiArticle }],
  [/wikidata\.org.*wbsearchentities/, { body: wikidataSearch }],
  [/wikidata\.org.*wbgetentities.*props=labels%7Cdescriptions/, { body: wikidataEntities }],
  [/wikidata\.org.*wbgetentities.*props=labels(&|$)/, { body: wikidataLabels }],
  [/api\.openalex\.org\/works\?filter=openalex_id/, { body: openalexRelated }],
  [/api\.openalex\.org\/works\/doi:/, { body: openalexWork }],
  [/api\.openalex\.org\/works\?/, { body: openalexSearch }],
  [/api\.crossref\.org\/works\?/, { body: { message: { "total-results": 1, items: [crossrefItem] } } }],
  [/api\.crossref\.org\/works\//, { body: { message: crossrefItem } }],
  [/esearch\.fcgi/, { body: pubmedSearch }],
  [/esummary\.fcgi/, { body: pubmedSummary }],
  [/efetch\.fcgi/, { raw: pubmedXml }],
  [/export\.arxiv\.org/, { raw: arxivXml }],
  [/api\.github\.com\/search\/repositories/, { body: { total_count: 1, items: [ghRepo] } }],
];
