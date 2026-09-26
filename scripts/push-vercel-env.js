const { execSync } = require("child_process");
const fs = require("fs");

const envPath = ".env.local";
const raw = fs.readFileSync(envPath, "utf8");
const pairs = [];
for (const line of raw.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const key = t.slice(0, i).trim();
  const value = t.slice(i + 1);
  if (!key || key === "SUPABASE_DIRECT_CONNECTION_STRING") continue; // unused at runtime
  pairs.push({ key, value });
}

const targets = ["production", "preview", "development"];

for (const { key, value } of pairs) {
  for (const target of targets) {
    try {
      execSync(`vercel env add ${key} ${target} --force --scope raghav-commandurs-projects`, {
        input: value + "\n",
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
      });
      console.log(`ok ${key} -> ${target}`);
    } catch (e) {
      const msg = (e.stderr || e.message || "").toString().slice(0, 200);
      console.log(`fail ${key} -> ${target}: ${msg}`);
    }
  }
}
