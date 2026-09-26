const domain = process.env.SHOPIFY_STORE_DOMAIN;
const token = process.env.SHOPIFY_ADMIN_TOKEN;

async function main() {
  let pageInfo = null;
  let published = 0;
  do {
    const url = new URL(`https://${domain}/admin/api/2024-10/products.json`);
    url.searchParams.set("limit", "50");
    url.searchParams.set("fields", "id,title,status,published_at,variants");
    url.searchParams.set("title", "Refurbished iPhone 14");
    if (pageInfo) url.searchParams.set("page_info", pageInfo);

    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });
    const link = res.headers.get("link") || "";
    const json = await res.json();
    const products = json.products || [];

    for (const p of products) {
      const price =
        p.variants?.[0]?.price && Number(p.variants[0].price) > 0
          ? p.variants[0].price
          : undefined;
      const body = {
        product: {
          id: p.id,
          status: "active",
          published: true,
          published_at: new Date().toISOString(),
        },
      };
      // leave price alone if already set
      const upd = await fetch(
        `https://${domain}/admin/api/2024-10/products/${p.id}.json`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
          },
          body: JSON.stringify(body),
        }
      );
      const out = await upd.json();
      published++;
      console.log(
        out.product?.title,
        out.product?.status,
        out.product?.published_at
      );
    }

    const next = link.match(/<[^>]+page_info=([^&>]+)[^>]*>; rel="next"/);
    pageInfo = next ? decodeURIComponent(next[1]) : null;
    if (products.length === 0) break;
  } while (pageInfo);

  console.log("published count", published);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
