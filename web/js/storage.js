const RECIPES_KEY='chefvoice.web.recipes.v1';
const DB_NAME='chefvoice-media-v1';
const AUDIO_STORE='session-audio';
const MEDIA_STORE='recipe-media';

export function loadRecipes(){try{return JSON.parse(localStorage.getItem(RECIPES_KEY)||'[]')}catch{return[]}}
export function saveRecipes(recipes){localStorage.setItem(RECIPES_KEY,JSON.stringify(recipes));}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in globalThis)) return reject(new Error('IndexedDB is unavailable.'));
    const req=indexedDB.open(DB_NAME,2);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(AUDIO_STORE))req.result.createObjectStore(AUDIO_STORE);
      if(!req.result.objectStoreNames.contains(MEDIA_STORE))req.result.createObjectStore(MEDIA_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open media storage.'));
  });
}

function runStore(storeName,mode,run){
  return openDb().then(db=>new Promise((resolve,reject)=>{
    const t=db.transaction(storeName,mode); const s=t.objectStore(storeName); let value;
    try{value=run(s);}catch(e){db.close();reject(e);return;}
    t.oncomplete=()=>{db.close();resolve(value)};
    t.onerror=()=>{db.close();reject(t.error||new Error('Media storage failed.'));};
  }));
}

function getStoreValue(storeName,key){
  return openDb().then(db=>new Promise((resolve,reject)=>{
    const t=db.transaction(storeName,'readonly');
    const req=t.objectStore(storeName).get(key);
    req.onsuccess=()=>{db.close();resolve(req.result||null)};
    req.onerror=()=>{db.close();reject(req.error||new Error('Could not load local media.'));};
  }));
}

export async function saveAudioBlob(recipeId,blob){
  await runStore(AUDIO_STORE,'readwrite',store=>store.put(blob,recipeId));
  return {stored:true,type:blob.type,size:blob.size};
}
export async function loadAudioBlob(recipeId){return getStoreValue(AUDIO_STORE,recipeId);}
export async function deleteAudioBlob(recipeId){try{await runStore(AUDIO_STORE,'readwrite',store=>store.delete(recipeId));}catch{}}

const mediaKey=(recipeId,mediaId)=>`${recipeId}:${mediaId}`;
export async function saveMediaBlob(recipeId,mediaId,blob){
  await runStore(MEDIA_STORE,'readwrite',store=>store.put(blob,mediaKey(recipeId,mediaId)));
  return {stored:true,type:blob.type,size:blob.size};
}
export async function loadMediaBlob(recipeId,mediaId){return getStoreValue(MEDIA_STORE,mediaKey(recipeId,mediaId));}
export async function deleteMediaBlob(recipeId,mediaId){try{await runStore(MEDIA_STORE,'readwrite',store=>store.delete(mediaKey(recipeId,mediaId)));}catch{}}
export async function deleteRecipeMedia(recipe){
  await Promise.all((recipe?.media||[]).map(item=>deleteMediaBlob(recipe.id,item.id)));
}
