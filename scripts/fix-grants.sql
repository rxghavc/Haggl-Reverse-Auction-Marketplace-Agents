-- Run once in Supabase Dashboard → SQL Editor
-- Fixes: permission denied for table listings / negotiations / outcomes

GRANT ALL ON TABLE public.listings TO service_role, anon, authenticated;
GRANT ALL ON TABLE public.negotiations TO service_role, anon, authenticated;
GRANT ALL ON TABLE public.outcomes TO service_role, anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, anon, authenticated;

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.negotiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

-- Permissive policies (demo)
DROP POLICY IF EXISTS "allow all listings" ON public.listings;
CREATE POLICY "allow all listings" ON public.listings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow all negotiations" ON public.negotiations;
CREATE POLICY "allow all negotiations" ON public.negotiations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "allow all outcomes" ON public.outcomes;
CREATE POLICY "allow all outcomes" ON public.outcomes FOR ALL USING (true) WITH CHECK (true);
