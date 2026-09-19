// Optional DOM integration checks: npm install --no-save jsdom
// Uses the real Activity-tab code (inboxTemplate/bindInbox and the swipe binding) with a
// simulated notifications endpoint, mirroring recipes-list.dom.mjs's slicing approach.
//
// This tab cannot be exercised against a real account the way the rest of the app can:
// notification documents are backend-created (`allow create: if false`), so a client can
// never make one to look at. These checks are the only coverage the row markup, the ✕, the
// swipe and the clear-read button get.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';

const swipe=await import('../js/swipe-gestures.js');

const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.COOK_TEST_MODULES?`${process.env.COOK_TEST_MODULES}/jsdom`:'jsdom');
const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
const dom=new JSDOM('<main id="main"></main>',{url:'http://localhost',runScripts:'outside-only'});
const w=dom.window;const document=w.document;

let deletedIds=[];let readIds=[];let deleteFails=false;let statuses=[];

const notification=(id,extra={})=>({
  id,type:'like',title:`Alert ${id}`,body:'Someone liked your recipe.',
  createdAt:Date.now(),readAt:0,...extra
});

Object.assign(w,{
  ...swipe,
  escapeHtml:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  relativeTime:()=>'just now',
  unreadCounts:()=>({messages:0,activity:w.cloud.notifications.filter(n=>n.readAt<=0).length}),
  conversationUnread:()=>false,otherUid:()=>'',otherName:()=>'',
  openConversation:null,threadMessages:[],
  safetyStatus:m=>{statuses.push(m);},
  render:()=>{w.renderInbox();},
  reportTarget:()=>{},blockChef:()=>{},unblockChef:()=>{},requireProfileName:()=>'Chef',
  openConversationView:()=>{},
  cloud:{
    user:{uid:'me'},blocked:new Set(),conversations:[],messageReads:{},notifications:[],
    api:{
      deleteNotification:async id=>{
        if(deleteFails)throw new Error('Missing or insufficient permissions.');
        deletedIds.push(id);
      },
      markNotificationRead:async id=>{readIds.push(id);}
    }
  }
});
// jsdom has no CSS.escape; the ids here are plain and need no quoting.
if(!w.CSS)w.CSS={escape:s=>String(s)};
else if(!w.CSS.escape)w.CSS.escape=s=>String(s);

// Two contiguous blocks: the swipe binding itself, and the Inbox from the notification
// glyphs through bindInbox. bindSaveSwipes and conversationTemplate come along with them
// (unavoidable, mid-block) but are never invoked here.
const swipeStart=source.indexOf('function bindSwipe(row,{onMove,onEnd}){');
const swipeEnd=source.indexOf('function bindCommunity(){',swipeStart);
const inboxStart=source.indexOf('/** Same glyphs Android');
const inboxEnd=source.indexOf('function openConversationView(',inboxStart);
assert.ok(swipeStart>0&&swipeEnd>swipeStart,'bindSwipe..bindSaveSwipes block found in app.js');
assert.ok(inboxStart>0&&inboxEnd>inboxStart,'notificationGlyph..bindInbox block found in app.js');
vm.runInContext(`const main=document.querySelector('#main');let inboxSection='activity';
${source.slice(swipeStart,swipeEnd)}
${source.slice(inboxStart,inboxEnd)}
function renderInbox(){main.innerHTML=inboxTemplate();bindInbox();}`,dom.getInternalVMContext());

const run=code=>vm.runInContext(code,dom.getInternalVMContext());
const get=s=>{const e=document.querySelector(s);assert.ok(e,`exists: ${s}`);return e;};
let checks=0;const check=(condition,message)=>{assert.ok(condition,message);checks++;};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

// jsdom has no PointerEvent; the code only reads pointerId, pointerType, button and the
// client coordinates, all of which a MouseEvent carries or can be given.
const pointer=(target,type,x,y)=>{
  const event=new w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true,cancelable:true});
  Object.defineProperty(event,'pointerId',{value:1});
  Object.defineProperty(event,'pointerType',{value:'touch'});
  target.dispatchEvent(event);
};
const swipeRow=(selector,dx,dy=3)=>{
  const row=get(selector);
  pointer(row,'pointerdown',0,300);
  pointer(row,'pointermove',dx/2,300+dy/2);
  pointer(row,'pointermove',dx,300+dy);
  pointer(row,'pointerup',dx,300+dy);
  return row;
};

w.cloud.notifications=[notification('n1'),notification('n2',{type:'follow',readAt:Date.now()})];
run('renderInbox();');

check(document.querySelectorAll('[data-swipe-dismiss]').length===2,'every notification is its own swipe row');
check(get('[data-swipe-dismiss="n1"] .notification-glyph').textContent==='♥','a like alert shows the heart glyph');
check(get('[data-swipe-dismiss="n2"] .notification-glyph').textContent==='👨‍🍳','a follow alert shows the chef glyph');
check(get('[data-swipe-dismiss="n1"] .swipe-card').classList.contains('unread'),'an unread alert is marked unread');
check(!get('[data-swipe-dismiss="n2"] .swipe-card').classList.contains('unread'),'a read alert is not');
check(!!document.querySelector('[data-read="n1"]'),'an unread alert offers Mark read');
check(!document.querySelector('[data-read="n2"]'),'an already-read alert does not');
check(get('[data-dismiss-notification="n1"]').textContent==='✕','each row carries a ✕ for chefs who would rather tap');
check(get('[data-dismiss-notification="n1"]').getAttribute('aria-label')==='Clear this notification','the ✕ says what it does');

// The ✕ clears one alert without touching the rest.
get('[data-dismiss-notification="n1"]').click();
await tick();
check(deletedIds.join()==='n1','the ✕ clears exactly that alert');
check(get('[data-swipe-dismiss="n1"]').classList.contains('clearing'),'the row goes out of the way at once, not after a round trip');
check(!get('[data-swipe-dismiss="n2"]').classList.contains('clearing'),'the other alert is untouched');

// A vertical scroll down the list must never clear anything.
deletedIds=[];
run('renderInbox();');
swipeRow('[data-swipe-dismiss="n1"]',4,180);
await tick();
check(deletedIds.length===0,'scrolling the list clears nothing');

// A short drag is not a clear either.
swipeRow('[data-swipe-dismiss="n1"]',40);
await tick();
check(deletedIds.length===0,'a short drag leaves the alert alone');

// Both directions clear, because both mean the same thing for one alert.
swipeRow('[data-swipe-dismiss="n1"]',140);
await tick();
check(deletedIds.join()==='n1','swiping right clears the alert');
deletedIds=[];
run('renderInbox();');
swipeRow('[data-swipe-dismiss="n2"]',-140);
await tick();
check(deletedIds.join()==='n2','swiping left clears it too');

// A delete that fails must put the row back rather than leave a cleared-looking alert that
// is still there.
deleteFails=true;deletedIds=[];statuses=[];
run('renderInbox();');
get('[data-dismiss-notification="n1"]').click();
await tick();
check(!get('[data-swipe-dismiss="n1"]').classList.contains('clearing'),'a failed clear restores the row');
check(!get('[data-dismiss-notification="n1"]').disabled,'and re-enables its ✕');
check(statuses.some(m=>m.includes('insufficient permissions')),'and says why, in the backend\'s own words');
deleteFails=false;

// Clear read notifications: everything already read, nothing still unread.
deletedIds=[];
run('renderInbox();');
check(!!document.querySelector('#clearReadNotifications'),'a read alert offers to clear the read ones');
get('#clearReadNotifications').click();
await tick();await tick();
check(deletedIds.join()==='n2','only the read alert is cleared');

w.cloud.notifications=[notification('n3')];
run('renderInbox();');
check(!document.querySelector('#clearReadNotifications'),'with nothing read, there is nothing to clear');

w.cloud.notifications=[];
run('renderInbox();');
check(get('.empty').textContent.includes('No activity yet'),'an empty tab says so');
check(!document.querySelector('[data-swipe-dismiss]'),'and has no rows to swipe');

console.log(`${checks} Inbox activity DOM checks passed.`);
dom.window.close();
