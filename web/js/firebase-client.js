import { firebaseConfig } from './firebase-config.js';
import { normalizeEntitlement, FREE_ENTITLEMENT } from './entitlement.js';
import * as ChefAnalytics from './chef-analytics.js';

// Firebase is loaded as browser modules so a CDN/Firebase outage cannot prevent
// local ChefVoice cooking capture from starting.
const SDK='12.17.1';
const [appSdk,authSdk,firestoreSdk,storageSdk]=await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-auth.js`),
  import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-firestore.js`),
  import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-storage.js`)
]);

const {initializeApp}=appSdk;
const {getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut}=authSdk;
const {
  getFirestore,collection,doc,limit,onSnapshot,query,setDoc,where,orderBy,
  getDoc,deleteDoc,updateDoc,runTransaction,writeBatch,increment
}=firestoreSdk;
const {getStorage,ref:storageRef,uploadBytes,getDownloadURL}=storageSdk;

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);
const storage=getStorage(app);

// Authentication, Firestore and Storage rules were verified in Firebase Console
// on 2026-08-12. Live/WebRTC remains a separate device-test gate.
export const CLOUD_WRITES_ENABLED=true;

// Analytics is best-effort and initialized alongside the app, never awaited by
// anything on the cooking path.
ChefAnalytics.initialize(app,SDK);

export function observeAuth(onChange){return onAuthStateChanged(auth,user=>onChange(user||null));}
export async function signIn(email,password){return (await signInWithEmailAndPassword(auth,email.trim(),password)).user;}
export async function signUp(email,password,displayName){
  assertWrites();
  const result=await createUserWithEmailAndPassword(auth,email.trim(),password);
  const user=result.user;
  const cleanName=String(displayName||'').trim()||email.split('@')[0]||'Chef';
  await saveUserProfile(user.uid,{displayName:cleanName,bio:'',photoUrl:'',createdAt:Date.now()});
  return user;
}
export async function signOutUser(){await signOut(auth);}

export function observeProfile(uid,onChange,onError=()=>{}){
  return onSnapshot(doc(db,'users',uid),snap=>onChange(snap.exists()?normalizeProfile(uid,snap.data()):null),onError);
}
export async function saveUserProfile(uid,profile){
  assertWrites();
  if(auth.currentUser?.uid!==uid)throw new Error('You can only edit your own ChefVoice profile.');
  await setDoc(doc(db,'users',uid),{
    displayName:String(profile.displayName||'Chef').trim()||'Chef',
    bio:String(profile.bio||'').trim(),
    photoUrl:String(profile.photoUrl||''),
    createdAt:Number(profile.createdAt||Date.now())
  },{merge:true});
}

/**
 * Mirrors the server-authoritative Pro entitlement. Read-only by rule; a write from
 * here would be rejected by Firestore, which is the intended design.
 *
 * A missing document means Free, not an error: every account starts without an
 * entitlement and most never get one. Read failures also fail closed to Free -- a
 * failed read must never read as Pro.
 */
export function observeProEntitlement(uid,onChange){
  return onSnapshot(doc(db,'users',uid,'entitlements','pro'),
    snap=>onChange(snap.exists()?normalizeEntitlement(snap.data()):{...FREE_ENTITLEMENT}),
    ()=>onChange({...FREE_ENTITLEMENT})
  );
}

export function observePublicRecipes(onChange,onError=()=>{}){
  const q=query(collection(db,'recipes'),where('isPublic','==',true),limit(100));
  return onSnapshot(q,snapshot=>{
    const recipes=snapshot.docs.map(d=>normalizeCloudRecipe(d.id,d.data())).sort((a,b)=>b.updatedAt-a.updatedAt);
    onChange(recipes);
  },onError);
}

export function observeUserRecipeIds(uid,kind,onChange,onError=()=>{}){
  if(!['likes','bookmarks','following'].includes(kind))throw new Error('Unknown ChefVoice user collection.');
  return onSnapshot(collection(db,'users',uid,kind),snap=>onChange(new Set(snap.docs.map(d=>d.id))),onError);
}

export async function publishRecipe(recipe,displayName,{mediaAssets=[],voiceBlob=null}={}){
  assertWrites();
  const user=requireUser('Sign in before publishing to Community.');
  const warnings=[];
  // Create/refresh an owner-readable Firestore document before Storage uploads.
  // This keeps Storage rule lookups valid while a brand-new recipe is uploading.
  const stageMedia=mediaAssets.filter(item=>item.remoteUrl).map(item=>({id:item.id,type:item.cloudType||cloudMediaType(item.type),url:item.remoteUrl}));
  const stage={...recipe,isPublic:recipe.isPublic===true,authorId:user.uid,authorName:String(displayName||'Chef').trim()||'Chef',media:stageMedia,voiceClips:recipe.voiceClips||[],updatedAt:Date.now(),likes:Number(recipe.likes||0),commentCount:Number(recipe.commentCount||0)};
  await setDoc(doc(db,'recipes',recipe.id),toCloudMap(stage));

  const uploadedMedia=[];
  for(const item of mediaAssets){
    if(item.remoteUrl){uploadedMedia.push({id:item.id,type:item.cloudType||cloudMediaType(item.type),url:item.remoteUrl});continue;}
    if(!item.blob){warnings.push(`Media ${item.name||item.id} stayed local because its file was unavailable.`);continue;}
    try{
      const ext=extensionFor(item.blob.type,item.name);
      const target=storageRef(storage,`recipes/${user.uid}/${recipe.id}/media/${item.id}.${ext}`);
      await uploadBytes(target,item.blob,{contentType:item.blob.type||undefined});
      uploadedMedia.push({id:item.id,type:item.cloudType||cloudMediaType(item.blob.type),url:await getDownloadURL(target)});
    }catch(e){warnings.push(`One photo/video stayed local (${friendlyError(e)}).`);}
  }

  const uploadedVoice=[];
  for(const oldClip of recipe.voiceClips||[]){if(oldClip?.url)uploadedVoice.push(oldClip);}
  if(voiceBlob?.size){
    try{
      const clipId=`session-${recipe.id}`;
      const ext=extensionFor(voiceBlob.type,'chef-voice');
      const target=storageRef(storage,`recipes/${user.uid}/${recipe.id}/voice/${clipId}.${ext}`);
      await uploadBytes(target,voiceBlob,{contentType:voiceBlob.type||undefined});
      uploadedVoice.push({id:clipId,label:'Full cooking session',createdAt:Date.now(),url:await getDownloadURL(target)});
    }catch(e){warnings.push(`Chef voice stayed local (${friendlyError(e)}).`);}
  }

  const now=Date.now();
  const published={
    ...recipe,
    isPublic:true,
    authorId:user.uid,
    authorName:String(displayName||'Chef').trim()||'Chef',
    media:uploadedMedia,
    voiceClips:uploadedVoice,
    updatedAt:now,
    likes:Number(recipe.likes||0),
    commentCount:Number(recipe.commentCount||0)
  };
  await setDoc(doc(db,'recipes',recipe.id),toCloudMap(published));
  return {recipe:published,warnings};
}

export async function unpublishRecipe(recipeId){
  assertWrites();
  const user=requireUser('Sign in first.');
  await updateDoc(doc(db,'recipes',recipeId),{isPublic:false,updatedAt:Date.now(),authorId:user.uid});
}
export async function deleteCloudRecipe(recipeId){assertWrites();requireUser('Sign in first.');await deleteDoc(doc(db,'recipes',recipeId));}

export async function toggleLike(recipeId){
  assertWrites();
  const user=requireUser('Sign in to like recipes.');
  const recipeRef=doc(db,'recipes',recipeId);
  const likeRef=doc(db,'recipes',recipeId,'likes',user.uid);
  const userLikeRef=doc(db,'users',user.uid,'likes',recipeId);
  let likedAfter=false;
  await runTransaction(db,async tx=>{
    const [recipeSnap,likeSnap]=await Promise.all([tx.get(recipeRef),tx.get(likeRef)]);
    if(!recipeSnap.exists())throw new Error('Recipe no longer exists.');
    const count=Math.max(0,Number(recipeSnap.data().likes||0));
    if(likeSnap.exists()){
      likedAfter=false;tx.delete(likeRef);tx.delete(userLikeRef);tx.update(recipeRef,{likes:Math.max(0,count-1)});
    }else{
      likedAfter=true;const data={createdAt:Date.now()};tx.set(likeRef,data);tx.set(userLikeRef,data);tx.update(recipeRef,{likes:count+1});
    }
  });
  return likedAfter;
}

export async function toggleBookmark(recipeId){
  assertWrites();
  const user=requireUser('Sign in to save Community recipes.');
  const target=doc(db,'users',user.uid,'bookmarks',recipeId);
  const existing=await getDoc(target);
  if(existing.exists()){await deleteDoc(target);return false;}
  await setDoc(target,{createdAt:Date.now()});return true;
}

export async function toggleFollow(targetUid){
  assertWrites();
  const user=requireUser('Sign in to follow chefs.');
  if(!targetUid||targetUid===user.uid)throw new Error('You cannot follow this profile.');
  const followingRef=doc(db,'users',user.uid,'following',targetUid);
  const followerRef=doc(db,'users',targetUid,'followers',user.uid);
  const existing=await getDoc(followingRef);
  const batch=writeBatch(db);
  if(existing.exists()){batch.delete(followingRef);batch.delete(followerRef);await batch.commit();return false;}
  const data={createdAt:Date.now()};batch.set(followingRef,data);batch.set(followerRef,data);await batch.commit();return true;
}

export function observeComments(recipeId,onChange,onError=()=>{}){
  const q=query(collection(db,'recipes',recipeId,'comments'),orderBy('createdAt'),limit(100));
  return onSnapshot(q,snap=>onChange(snap.docs.map(d=>({id:d.id,...normalizeComment(d.data())}))),onError);
}
export async function addComment(recipeId,text,authorName){
  assertWrites();
  const user=requireUser('Sign in to comment.');
  const clean=String(text||'').trim().slice(0,800);if(!clean)throw new Error('Write a comment first.');
  const recipeRef=doc(db,'recipes',recipeId);
  const commentRef=doc(collection(db,'recipes',recipeId,'comments'));
  const batch=writeBatch(db);
  batch.set(commentRef,{authorId:user.uid,authorName:String(authorName||'Chef').trim()||'Chef',text:clean,createdAt:Date.now()});
  batch.update(recipeRef,{commentCount:increment(1)});
  await batch.commit();
}

function toCloudMap(recipe){
  return {
    id:recipe.id,
    title:String(recipe.title||''),description:String(recipe.description||''),servings:Math.max(1,Number(recipe.servings||2)),
    ingredients:(recipe.ingredients||[]).map(i=>({id:String(i.id||crypto.randomUUID()),quantity:String(i.quantity||''),unit:String(i.unit||''),name:String(i.name||'')})),
    steps:(recipe.steps||[]).map(String),
    media:(recipe.media||[]).filter(i=>i?.url).map(i=>({id:String(i.id||crypto.randomUUID()),type:i.type==='VIDEO'?'VIDEO':'IMAGE',url:String(i.url)})),
    voiceClips:(recipe.voiceClips||[]).filter(i=>i?.url).map(i=>({id:String(i.id||crypto.randomUUID()),label:String(i.label||'Chef voice'),createdAt:Number(i.createdAt||Date.now()),url:String(i.url)})),
    isPublic:recipe.isPublic===true,authorId:String(recipe.authorId||''),authorName:String(recipe.authorName||'Chef'),
    createdAt:Number(recipe.createdAt||Date.now()),updatedAt:Number(recipe.updatedAt||Date.now()),likes:Math.max(0,Number(recipe.likes||0)),commentCount:Math.max(0,Number(recipe.commentCount||0))
  };
}

function normalizeCloudRecipe(id,data={}){
  return {
    id,title:String(data.title||'Untitled recipe'),description:String(data.description||''),servings:Math.max(1,Number(data.servings||2)),
    ingredients:Array.isArray(data.ingredients)?data.ingredients.map(item=>({id:String(item?.id||crypto.randomUUID()),quantity:String(item?.quantity||''),unit:String(item?.unit||''),name:String(item?.name||'')})):[],
    steps:Array.isArray(data.steps)?data.steps.map(String):[],
    media:Array.isArray(data.media)?data.media:[],voiceClips:Array.isArray(data.voiceClips)?data.voiceClips:[],
    isPublic:data.isPublic===true,authorId:String(data.authorId||''),authorName:String(data.authorName||'Chef'),createdAt:Number(data.createdAt||0),updatedAt:Number(data.updatedAt||0),likes:Math.max(0,Number(data.likes||0)),commentCount:Math.max(0,Number(data.commentCount||0))
  };
}
function normalizeProfile(uid,data={}){return {uid,displayName:String(data.displayName||'Chef'),bio:String(data.bio||''),photoUrl:String(data.photoUrl||''),createdAt:Number(data.createdAt||Date.now())};}
function normalizeComment(data={}){return {authorId:String(data.authorId||''),authorName:String(data.authorName||'Chef'),text:String(data.text||''),createdAt:Number(data.createdAt||0)};}
function requireUser(message){if(!auth.currentUser)throw new Error(message);return auth.currentUser;}
function assertWrites(){if(!CLOUD_WRITES_ENABLED)throw new Error('ChefVoice cloud writes are disabled.');}
function cloudMediaType(mime=''){return String(mime).startsWith('video/')?'VIDEO':'IMAGE';}
function extensionFor(mime='',name=''){
  const byMime={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/webm':'webm','audio/ogg':'ogg','audio/wav':'wav'};
  if(byMime[mime])return byMime[mime];
  const ext=String(name).split('.').pop()?.toLowerCase();return ext&&/^[a-z0-9]{2,5}$/.test(ext)?ext:'bin';
}
function friendlyError(e){return String(e?.message||e||'Storage unavailable').replace(/^Firebase:\s*/,'');}
