const { Client } = require("pg");

async function main() {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    throw new Error("Set SUPABASE_DB_PASSWORD in the environment");
  }
  const client = new Client({
    host: "2a05:d01c:1b7:9300:6521:5939:e47f:33c5",
    port: 5432,
    user: "postgres",
    password: process.env.SUPABASE_DB_PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  });
  console.log("connecting...");
  await client.connect();
  console.log("connected");
  await client.query(`
    GRANT ALL ON TABLE public.listings TO service_role, anon, authenticated;
    GRANT ALL ON TABLE public.negotiations TO service_role, anon, authenticated;
    GRANT ALL ON TABLE public.outcomes TO service_role, anon, authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, anon, authenticated;
  `);
  console.log("grants applied");
  const check = await client.query(`
    SELECT grantee, table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_name IN ('listings', 'negotiations', 'outcomes')
      AND grantee IN ('service_role', 'anon', 'authenticated')
    ORDER BY table_name, grantee, privilege_type
  `);
  console.log(JSON.stringify(check.rows, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
