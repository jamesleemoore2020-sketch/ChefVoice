// Applies the chef's Appearance choice (Profile: Auto / Light / Blackout) before anything is
// drawn. A classic script loaded from <head>, not a module, on purpose: app.js is a module and
// runs after the browser may already have painted the header and tab bar in the other theme.
//
// Auto needs nothing from here -- styles.css follows prefers-color-scheme by itself. Light and
// Blackout set data-theme on <html>, which styles.css prefers over the device setting, and
// point both theme-color metas (the browser's own toolbar) at the chosen theme.
(function(){
  var KEY='chefvoice.appearance';
  var TOOLBAR={light:'#f06423',dark:'#050505'};

  function read(){
    try{
      var value=localStorage.getItem(KEY);
      return value==='light'||value==='dark'?value:'auto';
    }catch(e){return 'auto';}
  }

  function apply(choice){
    var fixed=choice==='light'||choice==='dark';
    var root=document.documentElement;
    if(fixed)root.setAttribute('data-theme',choice);else root.removeAttribute('data-theme');
    var metas=document.querySelectorAll('meta[name="theme-color"][data-scheme]');
    for(var i=0;i<metas.length;i++){
      metas[i].setAttribute('content',TOOLBAR[fixed?choice:metas[i].getAttribute('data-scheme')]);
    }
  }

  function set(choice){
    try{
      if(choice==='light'||choice==='dark')localStorage.setItem(KEY,choice);
      else localStorage.removeItem(KEY);
    }catch(e){}
    apply(choice);
  }

  window.ChefVoiceAppearance={read:read,set:set};
  apply(read());
})();
