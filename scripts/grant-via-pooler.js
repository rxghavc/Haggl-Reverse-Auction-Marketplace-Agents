const { Client } = require("pg");

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("Set SUPABASE_DB_PASSWORD in the environment");
  process.exit(1);
}
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
const ref = "ehhkxfrxwzuxitehrqdg";
const regions = [
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "us-east-1",
  "us-west-1",
  "ap-southeast-1",
];
const ports = [6543, 5432];

const sql = `
GRANT ALL ON TABLE public.listings TO service_role, anon, authenticated;
GRANT ALL ON TABLE public.negotiations TO service_role, anon, authenticated;
GRANT ALL ON TABLE public.outcomes TO service_role, anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, anon, authenticated;
`;

async function main() {
  for (const region of regions) {
    for (const port of ports) {
      const host = `aws-0-${region}.pooler.supabase.com`;
      const user = `postgres.${ref}`;
      const cs = `postgresql://${user}:${password}@${host}:${port}/postgres`;
      const c = new Client({
        connectionString: cs,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 5000,
      });
      try {
        await c.connect();
        console.log("CONNECTED", host, port);
        await c.query(sql);
        console.log("GRANTS OK");
        await c.end();
        return;
      } catch (e) {
        console.log("fail", host, port, e.code || String(e.message).slice(0, 100));
        try {
          await c.end();
        } catch {}
      }
    }
  }
  process.exit(1);
}

main();
