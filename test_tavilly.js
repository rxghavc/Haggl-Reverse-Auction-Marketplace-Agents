const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

async function testSearch() {
  if (!TAVILY_API_KEY) {
    console.error("Set TAVILY_API_KEY in the environment");
    process.exit(1);
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: "iPhone 14 128GB refurbished unlocked price condition warranty",
      search_depth: "advanced",
      include_answer: false,
      max_results: 5,
    }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

testSearch();
