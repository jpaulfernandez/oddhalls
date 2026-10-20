import { z } from 'zod';
import { html, xml } from './http.js';

export const NarrowManifestSchema = z.object({
  slug: z.string().optional(),
  title: z.string(),
  listed: z.boolean(),
  password: z.unknown().optional().nullable(),
  cover: z.string().optional(),
  pages: z.array(z.record(z.string(), z.unknown())),
  images: z.record(z.string(), z.object({ share: z.string() })).optional(),
});
export type NarrowManifest = z.infer<typeof NarrowManifestSchema>;

export const NarrowSiteBookSchema = z.object({
  slug: z.string(),
  title: z.string(),
  cover: z.string().nullable().optional(),
  pages: z.number().int().nonnegative(),
  publishedAt: z.string(),
  locked: z.boolean().default(false),
});
export type NarrowSiteBook = z.infer<typeof NarrowSiteBookSchema>;

export const NarrowSiteSchema = z.object({
  books: z.array(NarrowSiteBookSchema).default([]),
  viewer: z.string().nullable().optional(),
});
export type NarrowSite = z.infer<typeof NarrowSiteSchema>;

const CARD_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title id="doc-title">Photobook</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="alternate" type="application/atom+xml" title="Feed" href="/feed.xml">
  <meta id="tag-desc" name="description" content="">
  <meta id="tag-robots" name="robots" content="noindex">
  <meta id="og-title" property="og:title" content="">
  <meta id="og-desc" property="og:description" content="">
  <meta id="og-type" property="og:type" content="website">
  <meta id="og-url" property="og:url" content="">
  <meta id="og-site" property="og:site_name" content="Photobook">
  <meta id="og-image" property="og:image" content="">
  <meta id="tw-card" name="twitter:card" content="summary">
  <meta id="tw-title" name="twitter:title" content="">
  <meta id="tw-desc" name="twitter:description" content="">
  <meta id="tw-image" name="twitter:image" content="">
  <link id="canonical-link" rel="canonical" href="">
  <meta id="refresh-meta" http-equiv="refresh" content="">
</head>
<body>
  <div id="content">
    <h1 id="heading">Photobook</h1>
    <p id="desc"></p>
    <p id="destination"><a id="target-link" href=""></a></p>
  </div>
  <script id="redirect-script"></script>
</body>
</html>`;

export function notFoundPage(): Response {
  return html(
    '<!doctype html><html><head><meta charset="utf-8"><title>Not Found</title></head><body><p>Not found</p></body></html>',
    404,
  );
}

export function cardResponse(manifest: NarrowManifest, site: NarrowSite, cardUrl: string, slug?: string): Response {
  const isPassword = Boolean(manifest.password);
  const title = manifest.title;
  const pageCount = manifest.pages.length;
  const description = isPassword
    ? 'A protected photo book'
    : pageCount === 1
      ? 'A photo book · 1 page'
      : `A photo book · ${pageCount} pages`;

  const image = isPassword ? null : (manifest.cover ?? Object.values(manifest.images ?? {})[0]?.share ?? null);
  const twitterCard = image ? 'summary_large_image' : 'summary';

  const bookSlug = slug ?? manifest.slug ?? '';
  const viewerBase = site.viewer?.trim().replace(/\/+$/, '');
  const targetUrl = viewerBase && bookSlug ? `${viewerBase}/${bookSlug}` : null;

  const rewriter = new HTMLRewriter()
    .on('title#doc-title', {
      element(e) {
        e.setInnerContent(title);
      },
    })
    .on('h1#heading', {
      element(e) {
        e.setInnerContent(title);
      },
    })
    .on('p#desc', {
      element(e) {
        e.setInnerContent(description);
      },
    })
    .on('meta#tag-desc', {
      element(e) {
        e.setAttribute('content', description);
      },
    })
    .on('meta#og-title', {
      element(e) {
        e.setAttribute('content', title);
      },
    })
    .on('meta#og-desc', {
      element(e) {
        e.setAttribute('content', description);
      },
    })
    .on('meta#og-type', {
      element(e) {
        e.setAttribute('content', 'website');
      },
    })
    .on('meta#og-url', {
      element(e) {
        e.setAttribute('content', cardUrl);
      },
    })
    .on('meta#og-site', {
      element(e) {
        e.setAttribute('content', 'Photobook');
      },
    })
    .on('meta#tw-card', {
      element(e) {
        e.setAttribute('content', twitterCard);
      },
    })
    .on('meta#tw-title', {
      element(e) {
        e.setAttribute('content', title);
      },
    })
    .on('meta#tw-desc', {
      element(e) {
        e.setAttribute('content', description);
      },
    })
    .on('meta#og-image', {
      element(e) {
        if (image) {
          e.setAttribute('content', image);
        } else {
          e.remove();
        }
      },
    })
    .on('meta#tw-image', {
      element(e) {
        if (image) {
          e.setAttribute('content', image);
        } else {
          e.remove();
        }
      },
    })
    .on('meta#tag-robots', {
      element(e) {
        if (!manifest.listed) {
          e.setAttribute('content', 'noindex');
        } else {
          e.remove();
        }
      },
    })
    .on('link#canonical-link', {
      element(e) {
        if (targetUrl) {
          e.setAttribute('href', targetUrl);
        } else {
          e.remove();
        }
      },
    })
    .on('meta#refresh-meta', {
      element(e) {
        if (targetUrl) {
          e.setAttribute('content', `0; url=${targetUrl}`);
        } else {
          e.remove();
        }
      },
    })
    .on('script#redirect-script', {
      element(e) {
        if (targetUrl) {
          e.setInnerContent(`location.replace(${JSON.stringify(targetUrl)});`, { html: true });
        } else {
          e.remove();
        }
      },
    })
    .on('p#destination', {
      element(e) {
        if (!targetUrl) {
          e.setInnerContent('Viewer URL not configured for this site.');
        }
      },
    })
    .on('a#target-link', {
      element(e) {
        if (targetUrl) {
          e.setAttribute('href', targetUrl);
          e.setInnerContent(`Open ${title}`);
        } else {
          e.remove();
        }
      },
    });

  return rewriter.transform(html(CARD_TEMPLATE));
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function atomFeed(site: NarrowSite, feedUrl: string): Response {
  const viewer = site.viewer ? site.viewer.trim().replace(/\/+$/, '') : '';
  const feedId = escapeXml(feedUrl);
  const selfLink = escapeXml(feedUrl);

  const books = [...(site.books ?? [])]
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, 50);

  const feedUpdated = books[0]?.publishedAt || new Date().toISOString();

  const entriesXml = books
    .map((book) => {
      const bookUrl = viewer ? `${viewer}/${book.slug}` : book.slug;
      const entryId = escapeXml(bookUrl);
      const entryLink = escapeXml(bookUrl);
      const entryTitle = escapeXml(book.title);
      const entryUpdated = escapeXml(book.publishedAt);
      const summaryText = `${book.pages} pages`;
      const entrySummary = escapeXml(summaryText);

      let contentXml = '';
      if (!book.locked && book.cover) {
        const imgTag = `&lt;img src="${escapeXml(book.cover)}" alt="${entryTitle}" /&gt;`;
        contentXml = `\n    <content type="html">${imgTag}</content>`;
      }

      return `  <entry>
    <id>${entryId}</id>
    <title>${entryTitle}</title>
    <updated>${entryUpdated}</updated>
    <link href="${entryLink}" />
    <summary>${entrySummary}</summary>${contentXml}
  </entry>`;
    })
    .join('\n');

  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${feedId}</id>
  <title>Photobook</title>
  <updated>${escapeXml(feedUpdated)}</updated>
  <link rel="self" href="${selfLink}" />${viewer ? `\n  <link rel="alternate" href="${escapeXml(viewer)}" />` : ''}
${entriesXml}
</feed>
`;

  return xml(xmlBody);
}
