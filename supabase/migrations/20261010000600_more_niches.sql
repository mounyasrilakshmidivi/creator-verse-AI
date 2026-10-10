-- CreatorVerse AI: five more niches (Comedy & Entertainment, Art & Design, Finance & Business,
-- Home Decor & DIY, Parenting & Family), matching CATEGORIES in js/data.js.
-- Only ADDS names to the allowed list used by the creator-profile and campaign checks;
-- the original ten stay valid, so no existing row is affected. Safe to run more than once.
create or replace function public.valid_niches() returns text[]
language sql immutable as $$
  select array['fashion','tech','food','fitness','travel','beauty','gaming','education','music','photography',
               'comedy','art','finance','home','parenting']
$$;
