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
  getDoc,getDocs,deleteDoc,updateDoc,runTransaction,writeBatch,documentId,startAfter
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
  // The `likes` counter on the recipe is backend-maintained. A client write to it
  // is rejected outright: validOwnerRecipeUpdate requires likes to be unchanged and
  // only lets the author update the recipe at all, so touching the counter here
  // failed the whole transaction and broke liking. Write only the two like
  // documents, in one transaction and with the same createdAt -- the rule pins them
  // together through getAfter().
  await runTransaction(db,async tx=>{
    const likeSnap=await tx.get(likeRef);
    if(likeSnap.exists()){
      likedAfter=false;tx.delete(likeRef);tx.delete(userLikeRef);
    }else{
      likedAfter=true;const data={createdAt:Date.now()};tx.set(likeRef,data);tx.set(userLikeRef,data);
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
/**
 * `commentCount` on the recipe is backend-maintained, exactly like `likes`. The
 * previous batch here also incremented it, which validOwnerRecipeUpdate rejects
 * (the count must be unchanged, and only the author may update the recipe at all),
 * so commenting failed for everyone. Write only the comment document.
 *
 * `authorName` must equal the author's current profile displayName -- the rule
 * checks it with profileNameMatches -- so callers pass the profile name, never a
 * fallback like an email prefix.
 */
export async function addComment(recipeId,text,authorName,parent=null){
  assertWrites();
  const user=requireUser('Sign in to comment.');
  const clean=String(text||'').trim().slice(0,800);if(!clean)throw new Error('Write a comment first.');
  const name=String(authorName||'').trim();
  if(!name)throw new Error('Your chef profile is still loading. Try again in a moment.');
  const payload={authorId:user.uid,authorName:name,text:clean,createdAt:Date.now()};
  if(parent?.id){
    // Threaded reply. The rule allows exactly these three extra keys.
    payload.parentCommentId=String(parent.id);
    payload.replyToUid=String(parent.authorId||'');
    payload.replyToName=String(parent.authorName||'Chef');
  }
  await setDoc(doc(collection(db,'recipes',recipeId,'comments')),payload);
}

// ---- Second Pass (ChefVoice Review) -----------------------------------------
// Explicit, opt-in re-transcription of the original cooking audio. The audio is
// uploaded to the private path (never attached to a public recipe), re-parsed by
// the same deterministic parser, and the differences are shown for the chef to
// accept or reject. Nothing is rewritten automatically.
//
// The upload is permit-gated: authorizeChefVoiceStorageUpload reserves budget and
// issues a token that the Storage rule checks against the object's metadata, so a
// client cannot upload without server authorization.

const SECOND_PASS_MAX_DURATION_MS=90*60*1000;
const SECOND_PASS_MAX_BYTES=120*1024*1024;

function audioContentType(blob){
  const raw=String(blob?.type||'').split(';')[0].trim().toLowerCase();
  if(raw.startsWith('audio/'))return raw;
  // MediaRecorder on some browsers reports video/webm for an audio-only capture,
  // but the permit and the Storage rule both require an audio/* content type.
  if(raw==='video/webm')return 'audio/webm';
  if(raw==='video/mp4')return 'audio/mp4';
  return 'audio/webm';
}

/** Reads duration without decoding the whole file. Returns 0 when unknown. */
function audioDurationMs(blob){
  return new Promise(resolve=>{
    let url='';
    try{
      url=URL.createObjectURL(blob);
      const probe=new Audio();
      const done=value=>{try{URL.revokeObjectURL(url);}catch{} resolve(value);};
      probe.preload='metadata';
      probe.onloadedmetadata=()=>{
        const seconds=probe.duration;
        done(Number.isFinite(seconds)&&seconds>0?Math.round(seconds*1000):0);
      };
      probe.onerror=()=>done(0);
      // A browser that never fires either event must not hang the review.
      setTimeout(()=>done(0),8000);
      probe.src=url;
    }catch{
      if(url)try{URL.revokeObjectURL(url);}catch{}
      resolve(0);
    }
  });
}

async function callFunction(name,payload){
  const functionsSdk=await import(`https://www.gstatic.com/firebasejs/${SDK}/firebase-functions.js`);
  const functions=functionsSdk.getFunctions(app,'us-central1');
  return (await functionsSdk.httpsCallable(functions,name,{timeout:30*60*1000})(payload)).data;
}

/**
 * Uploads the original cooking audio privately and runs the cloud transcription.
 * Returns the raw cloud result; diffing it against the current recipe is
 * second-pass-reviewer.js's job.
 */
export async function transcribePrivateChefVoice(recipeId,audioBlob){
  assertWrites();
  const user=requireUser('Sign in before running ChefVoice Review.');
  if(!audioBlob?.size||audioBlob.size<=44)throw new Error('The original local cooking audio could not be found.');
  if(!user.emailVerified)throw new Error('Verify your email before using ChefVoice Review. Local Cook & Capture remains available.');
  if(audioBlob.size>SECOND_PASS_MAX_BYTES)throw new Error('That cooking recording is too large for ChefVoice Review. The local recording is unchanged.');

  const durationMs=await audioDurationMs(audioBlob);
  if(durationMs<=0)throw new Error('ChefVoice could not read the original audio duration. The local recording was not changed.');
  if(durationMs>SECOND_PASS_MAX_DURATION_MS)throw new Error('ChefVoice Review supports cooking recordings up to 90 minutes. The original local audio is unchanged.');

  const contentType=audioContentType(audioBlob);
  const permit=await callFunction('authorizeChefVoiceStorageUpload',{
    kind:'private_session',recipeId,fileName:'session',bytes:audioBlob.size,contentType
  });
  if(!permit?.permitId||!permit?.token)throw new Error('ChefVoice could not authorize the private audio upload.');

  const target=storageRef(storage,`privateVoice/${user.uid}/${recipeId}/session`);
  await uploadBytes(target,audioBlob,{
    contentType,
    // The Storage rule compares both against the permit document.
    customMetadata:{
      chefvoiceDurationMs:String(durationMs),
      chefvoicePermitId:permit.permitId,
      chefvoiceUploadToken:permit.token
    }
  });

  const data=await callFunction('transcribeChefVoice',{recipeId});
  if(!data||typeof data!=='object')throw new Error('ChefVoice Review returned an unreadable response.');
  const rawSegments=Array.isArray(data.segments)?data.segments:[];
  return {
    provider:String(data.provider||'')||'google-cloud-speech-v2',
    model:String(data.model||'')||'chirp_3',
    transcript:String(data.transcript||''),
    segments:rawSegments.map(row=>String(row?.text||'').trim()).filter(Boolean),
    processedAt:Number(data.processedAt||Date.now())
  };
}

// ---- Chef discovery ---------------------------------------------------------
// `allow get: if true` keeps single profile reads open for recipe cards, but
// listing requires sign-in: "read: if true" would let anyone holding the API key
// enumerate every chef's display name, bio and favorite things. Search therefore
// pages the collection while signed in and filters client-side, matching
// FirebaseSocialRepository.searchChefProfiles including its scan caps.

const SEARCH_PAGE=50;
const SEARCH_MAX_MATCHES=12;
const SEARCH_MAX_SCANNED=300;

export async function searchChefProfiles(searchText){
  const term=String(searchText||'').trim().toLowerCase();
  if(term.length<2)return [];
  requireUser('Sign in to search for chefs.');

  const matches=[];
  let scanned=0;
  let cursor=null;

  while(matches.length<SEARCH_MAX_MATCHES&&scanned<SEARCH_MAX_SCANNED){
    const constraints=[orderBy(documentId()),limit(SEARCH_PAGE)];
    if(cursor)constraints.push(startAfter(cursor));
    const snap=await getDocs(query(collection(db,'users'),...constraints));
    scanned+=snap.size;
    for(const d of snap.docs){
      if(matches.length>=SEARCH_MAX_MATCHES)break;
      const profile=normalizeProfile(d.id,d.data());
      const haystack=[profile.displayName,profile.bio,...(profile.favoriteThings||[])].join(' ').toLowerCase();
      if(haystack.includes(term))matches.push(profile);
    }
    cursor=snap.docs[snap.docs.length-1]||null;
    if(snap.size<SEARCH_PAGE||!cursor)break;
  }
  return matches;
}

/** Public recipes by one chef. Follower identities stay private; only the count is public. */
export function observeChefRecipes(authorUid,onChange,onError=()=>{}){
  const q=query(collection(db,'recipes'),where('authorId','==',authorUid),where('isPublic','==',true),limit(50));
  return onSnapshot(q,snap=>{
    const items=snap.docs.map(d=>normalizeCloudRecipe(d.id,d.data())).sort((a,b)=>b.updatedAt-a.updatedAt);
    onChange(items);
  },onError);
}

// ---- Direct messages --------------------------------------------------------
// The conversation id is the two uids sorted and joined with '--'; firestore.rules
// checks that shape both ways round, and derives participation from it. Preview
// metadata (lastMessage/lastSenderId) is maintained by backend triggers -- the
// rule forbids client updates to a conversation entirely.

export function conversationIdFor(uidA,uidB){return [uidA,uidB].sort().join('--');}

/** One-shot profile read. Used where a rule compares against the live displayName. */
export async function getProfile(uid){
  if(!uid)return null;
  const snap=await getDoc(doc(db,'users',uid));
  return snap.exists()?normalizeProfile(uid,snap.data()):null;
}

export function observeConversations(uid,onChange,onError=()=>{}){
  const q=query(collection(db,'conversations'),where('participantIds','array-contains',uid),limit(100));
  return onSnapshot(q,snap=>{
    const items=snap.docs.map(d=>normalizeConversation(d.id,d.data())).sort((a,b)=>b.updatedAt-a.updatedAt);
    onChange(items);
  },onError);
}

export function observeDirectMessages(conversationId,onChange,onError=()=>{}){
  const q=query(collection(db,'conversations',conversationId,'messages'),orderBy('createdAt'),limit(250));
  return onSnapshot(q,snap=>onChange(snap.docs.map(d=>({
    id:d.id,
    senderId:String(d.data().senderId||''),
    senderName:String(d.data().senderName||'Chef'),
    text:String(d.data().text||''),
    createdAt:Number(d.data().createdAt||0)
  }))),onError);
}

/**
 * Opens the conversation with another chef, creating it if this is the first
 * message. Both display names must match their profiles exactly -- the rule checks
 * each with profileNameMatches -- so the caller supplies the target's real profile
 * name rather than whatever a feed card happened to render.
 */
export async function startConversation(targetUid,targetName,ownName){
  assertWrites();
  const user=requireUser('Sign in to message chefs.');
  if(!targetUid||targetUid===user.uid)throw new Error('Choose another ChefVoice member to message.');
  const own=String(ownName||'').trim();
  const target=String(targetName||'').trim();
  if(!own||!target)throw new Error('Chef profiles are still loading. Try again in a moment.');

  const ids=[user.uid,targetUid].sort();
  const conversationId=ids.join('--');
  const ref=doc(db,'conversations',conversationId);
  const existing=await getDoc(ref);
  if(existing.exists())return normalizeConversation(conversationId,existing.data());

  const now=Date.now();
  const participantNames={[user.uid]:own,[targetUid]:target};
  // lastMessage/lastSenderId must be empty on create; the backend fills them in.
  await setDoc(ref,{participantIds:ids,participantNames,lastMessage:'',lastSenderId:'',createdAt:now,updatedAt:now});
  return normalizeConversation(conversationId,{participantIds:ids,participantNames,lastMessage:'',lastSenderId:'',createdAt:now,updatedAt:now});
}

export async function sendDirectMessage(conversation,text,senderName){
  assertWrites();
  const user=requireUser('Sign in to send messages.');
  if(!conversation?.participantIds?.includes(user.uid))throw new Error('This conversation is not available to this account.');
  const clean=String(text||'').trim().slice(0,2000);
  if(!clean)throw new Error('Write a message first.');
  const name=String(senderName||'').trim();
  if(!name)throw new Error('Your chef profile is still loading. Try again in a moment.');
  await setDoc(doc(collection(db,'conversations',conversation.id,'messages')),{
    senderId:user.uid,senderName:name,text:clean,createdAt:Date.now()
  });
}

export function observeMessageReads(uid,onChange,onError=()=>{}){
  return onSnapshot(collection(db,'users',uid,'messageReads'),
    snap=>{
      const map={};
      snap.docs.forEach(d=>{map[d.id]=Number(d.data().lastReadAt||0);});
      onChange(map);
    },onError);
}

/**
 * The rule requires lastReadAt to be monotonic on update, so a stale listener can
 * never walk a read marker backwards and resurrect old unread badges.
 */
export async function markConversationRead(conversationId,lastReadAt){
  assertWrites();
  const user=requireUser('Sign in to update unread messages.');
  if(!conversationId||!(lastReadAt>0))return;
  const belongsToUser=conversationId.startsWith(user.uid+'--')||conversationId.endsWith('--'+user.uid);
  if(!belongsToUser)throw new Error('This conversation is not available to this account.');
  await setDoc(doc(db,'users',user.uid,'messageReads',conversationId),{conversationId,lastReadAt:Math.floor(lastReadAt)});
}

// ---- In-app activity notifications -----------------------------------------
// Records are backend-created (`allow create: if false`); the client may read its
// own and advance `readAt`, nothing else. This is the in-app feed only -- FCM web
// push is a separate piece of infrastructure and is not wired up here.

export function observeNotifications(uid,onChange,onError=()=>{}){
  const q=query(collection(db,'users',uid,'notifications'),orderBy('createdAt','desc'),limit(100));
  return onSnapshot(q,snap=>onChange(snap.docs.map(d=>{
    const data=d.data()||{};
    return {
      id:d.id,
      type:String(data.type||''),
      actorUid:String(data.actorUid||''),
      actorName:String(data.actorName||'Chef'),
      title:String(data.title||'ChefVoice'),
      body:String(data.body||''),
      recipeId:String(data.recipeId||''),
      conversationId:String(data.conversationId||''),
      liveSessionId:String(data.liveSessionId||''),
      commentId:String(data.commentId||''),
      createdAt:Number(data.createdAt||0),
      readAt:Number(data.readAt||0)
    };
  })),onError);
}

export async function markNotificationRead(notificationId,readAt=Date.now()){
  assertWrites();
  const user=requireUser('Sign in to update notifications.');
  // The rule allows only readAt to change, and only forwards.
  await updateDoc(doc(db,'users',user.uid,'notifications',notificationId),{readAt:Math.floor(readAt)});
}

export async function deleteNotification(notificationId){
  assertWrites();
  const user=requireUser('Sign in to update notifications.');
  await deleteDoc(doc(db,'users',user.uid,'notifications',notificationId));
}

// ---- Safety: blocking and reporting ----------------------------------------
// Both write shapes are pinned by firestore.rules, which accepts an exact key set
// and rejects anything else. Keep these payloads byte-compatible with
// FirebaseSocialRepository.setUserBlocked/reportContent -- a divergence here is a
// permission-denied at best and a moderation gap at worst.

export const REPORT_TARGET_TYPES=Object.freeze(['user','recipe','comment','reply','message']);

export function observeBlockedUserIds(uid,onChange,onError=()=>{}){
  const q=query(collection(db,'users',uid,'blocks'),limit(500));
  return onSnapshot(q,snap=>onChange(new Set(snap.docs.map(d=>d.id))),onError);
}

export async function setUserBlocked(blockedUid,blocked){
  assertWrites();
  const user=requireUser('Sign in to manage blocked chefs.');
  if(!blockedUid||blockedUid===user.uid)throw new Error('Choose another ChefVoice member.');
  const target=doc(db,'users',user.uid,'blocks',blockedUid);
  if(!blocked){await deleteDoc(target);return false;}
  // The rule requires exactly these two keys, the document id to match
  // blockedUid, and a client clock within five minutes of the server's.
  await setDoc(target,{blockedUid,createdAt:Date.now()});
  return true;
}

export async function reportContent({targetType,targetId='',targetUid='',contextId='',reason=''}={}){
  assertWrites();
  const user=requireUser('Sign in to report ChefVoice content.');
  const type=String(targetType||'').trim();
  if(!REPORT_TARGET_TYPES.includes(type))throw new Error('Unsupported report type.');
  const cleanReason=String(reason||'').trim().slice(0,500)||'Safety concern';
  await setDoc(doc(collection(db,'reports')),{
    reporterUid:user.uid,
    targetType:type,
    targetId:String(targetId||'').trim().slice(0,180),
    targetUid:String(targetUid||'').trim().slice(0,180),
    contextId:String(contextId||'').trim().slice(0,180),
    reason:cleanReason,
    createdAt:Date.now(),
    // Moderation state is advanced only by the moderator-only callable; the
    // client may open a report and nothing else.
    status:'open'
  });
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
function normalizeProfile(uid,data={}){
  return {
    uid,
    displayName:String(data.displayName||'Chef'),
    bio:String(data.bio||''),
    photoUrl:String(data.photoUrl||''),
    coverPhotoUrl:String(data.coverPhotoUrl||''),
    favoriteThings:Array.isArray(data.favoriteThings)?data.favoriteThings.map(String):[],
    createdAt:Number(data.createdAt||Date.now()),
    // Backend-maintained. Follower identities are private; only the count is public.
    followerCount:Math.max(0,Number(data.followerCount||0))
  };
}
function normalizeComment(data={}){return {authorId:String(data.authorId||''),authorName:String(data.authorName||'Chef'),text:String(data.text||''),createdAt:Number(data.createdAt||0),parentCommentId:String(data.parentCommentId||''),replyToUid:String(data.replyToUid||''),replyToName:String(data.replyToName||'')};}
function normalizeConversation(id,data={}){
  const participantIds=Array.isArray(data.participantIds)?data.participantIds.map(String):[];
  return {
    id,
    participantIds,
    participantNames:data.participantNames&&typeof data.participantNames==='object'?data.participantNames:{},
    lastMessage:String(data.lastMessage||''),
    lastSenderId:String(data.lastSenderId||''),
    createdAt:Number(data.createdAt||0),
    updatedAt:Number(data.updatedAt||0)
  };
}
export function otherParticipant(conversation,uid){return (conversation?.participantIds||[]).find(id=>id!==uid)||'';}
function requireUser(message){if(!auth.currentUser)throw new Error(message);return auth.currentUser;}
function assertWrites(){if(!CLOUD_WRITES_ENABLED)throw new Error('ChefVoice cloud writes are disabled.');}
function cloudMediaType(mime=''){return String(mime).startsWith('video/')?'VIDEO':'IMAGE';}
function extensionFor(mime='',name=''){
  const byMime={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/webm':'webm','audio/ogg':'ogg','audio/wav':'wav'};
  if(byMime[mime])return byMime[mime];
  const ext=String(name).split('.').pop()?.toLowerCase();return ext&&/^[a-z0-9]{2,5}$/.test(ext)?ext:'bin';
}
function friendlyError(e){return String(e?.message||e||'Storage unavailable').replace(/^Firebase:\s*/,'');}
