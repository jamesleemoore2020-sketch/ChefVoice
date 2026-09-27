// The Community feed's paging arithmetic, kept out of app.js so it can be tested directly.

/**
 * The feed as the chef sees it: the live newest page, then any older pages they loaded,
 * then any recipe opened from a shared link. A recipe that is edited moves out of an older
 * page into the live one, so the first copy seen -- the live one, since the head is passed
 * first -- wins and each recipe appears once. Newest first, matching the query order
 * (updatedAt descending), so a linked recipe lands where it would have been paged in.
 */
export function mergeFeedPages(...pages) {
  const byId = new Map();
  for (const page of pages) {
    for (const recipe of page || []) {
      if (recipe?.id && !byId.has(recipe.id)) byId.set(recipe.id, recipe);
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}
