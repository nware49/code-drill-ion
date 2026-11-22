// Bank authoring helper.
// ans(name, tier, lore, aliases?, key?)
//   tier 0 = autocomplete (the first thing everyone says) ... 5 = ring -3 (a true deep cut)
//   key   = optional burn key, to make the same answer collide across prompts
export const ans = (n, t, l = '', alias = [], k = undefined) => (k ? { n, t, l, alias, k } : { n, t, l, alias });
