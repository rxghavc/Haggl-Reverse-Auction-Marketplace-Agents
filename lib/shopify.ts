import type { Listing } from "./types";

type ShopifyCreateResult = {
  productId: string | null;
  error?: string;
};

/**
 * Best-effort Shopify Admin product write. Never throws into negotiation path.
 * Metafields: condition_grade, warranty_months, original_listed_date (today).
 */
export async function createProductFromListing(
  listing: Pick<
    Listing,
    "vendor" | "price" | "condition_grade" | "warranty_months" | "source_url"
  > & { original_listed_date?: string | null }
): Promise<ShopifyCreateResult> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!domain || !token) {
    return { productId: null, error: "Shopify credentials missing" };
  }

  const today =
    listing.original_listed_date ?? new Date().toISOString().slice(0, 10);
  const title = `Refurbished iPhone 14 128GB — ${listing.vendor}`;

  const mutation = `
    mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product { id }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    product: {
      title,
      vendor: listing.vendor,
      status: "ACTIVE",
      productType: "Refurbished Phone",
      descriptionHtml: `<p>Sourced listing. <a href="${listing.source_url}">Source</a></p>`,
      metafields: [
        {
          namespace: "custom",
          key: "condition_grade",
          type: "single_line_text_field",
          value: listing.condition_grade ?? "unknown",
        },
        {
          namespace: "custom",
          key: "warranty_months",
          type: "number_integer",
          value: String(listing.warranty_months ?? 0),
        },
        {
          namespace: "custom",
          key: "original_listed_date",
          type: "date",
          value: today,
        },
      ],
    },
  };

  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: mutation, variables }),
      }
    );

    const json = (await res.json()) as {
      data?: {
        productCreate?: {
          product?: { id: string };
          userErrors?: Array<{ message: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    const errors = json.errors ?? json.data?.productCreate?.userErrors ?? [];
    if (!res.ok || errors.length) {
      // Fallback: REST product create (simpler, price on variant)
      return createProductRest(listing, today, domain, token);
    }

    const gid = json.data?.productCreate?.product?.id ?? null;
    if (gid) {
      await setVariantPrice(gid, listing.price, domain, token);
      await publishViaRest(gid, domain, token);
    }
    return { productId: gid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shopify] create failed", msg);
    return { productId: null, error: msg };
  }
}

async function setVariantPrice(
  productGid: string,
  price: number,
  domain: string,
  token: string
): Promise<void> {
  const query = `
    query ($id: ID!) {
      product(id: $id) {
        variants(first: 1) { edges { node { id } } }
      }
    }
  `;
  const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables: { id: productGid } }),
  });
  const json = (await res.json()) as {
    data?: {
      product?: {
        variants?: { edges: Array<{ node: { id: string } }> };
      };
    };
  };
  const variantId = json.data?.product?.variants?.edges?.[0]?.node?.id;
  if (!variantId) return;

  const mutation = `
    mutation ($product: ProductVariantsBulkInput!) {
      productVariantsBulkUpdate(productId: "${productGid}", variants: [{ id: "${variantId}", price: "${price.toFixed(2)}" }]) {
        productVariants { id }
        userErrors { message }
      }
    }
  `;
  await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query: mutation }),
  });
}

async function publishViaRest(
  productGidOrId: string,
  domain: string,
  token: string
): Promise<void> {
  const numericId = productGidOrId.includes("/")
    ? productGidOrId.split("/").pop()
    : productGidOrId;
  if (!numericId) return;
  try {
    await fetch(
      `https://${domain}/admin/api/2024-10/products/${numericId}.json`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          product: {
            id: Number(numericId),
            status: "active",
            published: true,
            published_at: new Date().toISOString(),
          },
        }),
      }
    );
  } catch (e) {
    console.warn("[shopify] REST publish failed", e);
  }
}

/** @deprecated publications scope often missing; use publishViaRest */
async function publishToOnlineStore(
  productGid: string,
  domain: string,
  token: string
): Promise<void> {
  await publishViaRest(productGid, domain, token);
}

async function createProductRest(
  listing: Pick<Listing, "vendor" | "price" | "condition_grade" | "warranty_months" | "source_url">,
  today: string,
  domain: string,
  token: string
): Promise<ShopifyCreateResult> {
  try {
    const res = await fetch(
      `https://${domain}/admin/api/2024-10/products.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({
          product: {
            title: `Refurbished iPhone 14 128GB — ${listing.vendor}`,
            vendor: listing.vendor,
            product_type: "Refurbished Phone",
            status: "active",
            published: true,
            body_html: `<p>Sourced listing. <a href="${listing.source_url}">Source</a></p>`,
            variants: [{ price: listing.price.toFixed(2) }],
            metafields: [
              {
                namespace: "custom",
                key: "condition_grade",
                type: "single_line_text_field",
                value: listing.condition_grade ?? "unknown",
              },
              {
                namespace: "custom",
                key: "warranty_months",
                type: "number_integer",
                value: String(listing.warranty_months ?? 0),
              },
              {
                namespace: "custom",
                key: "original_listed_date",
                type: "date",
                value: today,
              },
            ],
          },
        }),
      }
    );
    const json = (await res.json()) as {
      product?: { id: number };
      errors?: unknown;
    };
    if (!res.ok || !json.product?.id) {
      return {
        productId: null,
        error: `REST create failed: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`,
      };
    }
    await publishViaRest(String(json.product.id), domain, token);
    return { productId: String(json.product.id) };
  } catch (e) {
    return {
      productId: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
