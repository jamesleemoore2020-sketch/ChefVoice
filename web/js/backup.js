/**
 * Private backup of a chef's recipes and original cooking audio to their own account
 * (audit F11), as decisions with no Firebase in them. Android's port is
 * app/src/main/java/com/chefvoice/app/util/RecipeBackup.kt.
 *
 * A backup is a recipe document with isPublic:false, its photos and videos in the recipe's
 * Storage slots (readable only by the chef while it is private), and the original recording at
 * privateVoice/{uid}/{recipeId}/session, the path ChefVoice Review already uses. The rules
 * already allowed all of it, so nothing about security changed.
 *
 * What it never does: change whether a recipe is on Community, or send the edits of a
 * published recipe there. Those stay the explicit Publish they always were. A published recipe
 * is already in the account, as published.
 *
 * In this browser a recipe has one recording, saved with it and never replaced, so
 * `audioBackedUp` says whether the account holds it (Android names the clip, because a phone
 * can record a session into a recipe again). `backedUpAt` is the updatedAt of the version the
 * account holds. Both are local: toCloudMap sends an allow-list of fields and neither is on it.
 */

/** Photo and video slots a recipe has in the account: the Storage permit's slot-00 to slot-23. */
export const MEDIA_SLOTS=24;

/** Whether this recipe has something the chef's account does not hold yet. */
export function needsBackup(recipe,uid){
  return Boolean(uid)
    &&recipe?.isPublic!==true
    &&(!recipe.authorId||recipe.authorId===uid)
    &&Number(recipe.updatedAt||0)>Number(recipe.backedUpAt||0);
}

/** The account's recipes this browser does not have, newest first. */
export function restorable(cloudRecipes,localRecipes){
  const here=new Set((localRecipes||[]).map(r=>r.id));
  return (cloudRecipes||[]).filter(r=>!here.has(r.id)).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
}

/**
 * Whether a backup of `snapshot` holds everything it could: every photo and video kept in this
 * browser that has a slot, and the recording if the browser has one. A recipe backed up only in
 * part stays waiting, and the next backup sends what is missing. What the browser no longer has
 * (`missingMedia`, the ids whose files are gone; `audioMissing`) can never be sent, so it does
 * not hold a backup open.
 */
export function complete(snapshot,result,{missingMedia=new Set(),audioMissing=false}={}){
  const held=new Set((result?.remoteMedia||[]).filter(m=>m?.url).map(m=>m.id));
  // A restored photo is marked stored:false: it lives in the account, not in this browser.
  const mediaHeld=(snapshot?.media||[]).slice(0,MEDIA_SLOTS)
    .every(item=>item?.stored===false||missingMedia.has(item.id)||held.has(item.id));
  const audioHeld=!snapshot?.sessionAudio?.stored||audioMissing||snapshot.audioBackedUp===true||result?.audioUploaded===true;
  return mediaHeld&&audioHeld;
}

/**
 * What a backup of `snapshot` taught the recipe as it is now, as the fields to assign to it, so
 * a screen holding the recipe sees them. The chef may have changed it while the upload ran; that
 * is kept, and because backedUpAt records the version that went up, the changed recipe still
 * reads as needing a backup. It only moves when the backup was complete.
 */
export function afterBackup(current,snapshot,result,isComplete){
  const remote=new Map((current.remoteMedia||[]).filter(m=>m?.url).map(m=>[m.id,m]));
  for(const item of result?.remoteMedia||[])if(item?.url&&!remote.has(item.id))remote.set(item.id,item);
  return {
    authorId:result.authorId,
    authorName:result.authorName,
    remoteMedia:[...remote.values()],
    backedUpAt:isComplete?Math.max(Number(current.backedUpAt||0),Number(snapshot.updatedAt||0)):Number(current.backedUpAt||0),
    audioBackedUp:current.audioBackedUp===true||result.audioUploaded===true
  };
}

/**
 * A recipe from the account, as this browser keeps it: already backed up as it stands. Its
 * photos and videos stay in the account and show from there; each keeps a media entry, as a
 * published recipe's do, so publishing it later sends them again rather than dropping them.
 * `audio` says what became of its recording: 'stored' (saved in this browser, `sessionAudio` is
 * what saving it answered), 'in-account' (the account has one this browser could not download),
 * or 'none'.
 */
export function restored(cloudRecipe,audio,sessionAudio={stored:true}){
  const remoteMedia=(cloudRecipe.media||[]).filter(m=>m?.url);
  return {
    ...cloudRecipe,
    media:remoteMedia.map(m=>({id:m.id,type:m.type==='VIDEO'?'video/mp4':'image/jpeg',stored:false})),
    remoteMedia,
    transcript:[],
    backedUpAt:Number(cloudRecipe.updatedAt||0),
    audioBackedUp:audio==='stored'||audio==='in-account',
    ...(audio==='stored'?{sessionAudio}:{}),
    ...(audio==='in-account'?{audioInAccount:true}:{})
  };
}
