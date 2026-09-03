const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'app/src/main/java/com/chefvoice/app/ui/ChefVoiceApp.kt'),'utf8');
const gradle=fs.readFileSync(path.join(root,'app/build.gradle.kts'),'utf8');
const checks=[
 ['Android v0.10.1 version',/versionCode = 52/.test(gradle)&&/versionName = "0\.10\.1"/.test(gradle)],
 ['Blackout dark color scheme exists',/ChefVoiceBlackoutColorScheme = darkColorScheme/.test(app)&&/background = Color\(0xFF050505\)/.test(app)],
 ['Blackout setting persists locally',/getSharedPreferences\("chefvoice_appearance", 0\)/.test(app)&&/putBoolean\("blackout", enabled\)/.test(app)],
 ['Theme switches globally',/if \(blackoutMode\) ChefVoiceBlackoutColorScheme else ChefVoiceColorScheme/.test(app)],
 ['Profile exposes Blackout toggle',/Text\(if \(blackoutMode\) "☀ Light" else "🌙 Blackout"\)/.test(app)]
];
let fail=0;for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'}: ${name}`);if(!ok)fail++;}process.exitCode=fail?1:0;
