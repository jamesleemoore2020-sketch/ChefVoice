import { containsMeasurementEvidence, measurementEvidenceCount, normalizeSpeechText } from './ingredient-parser.js';
import { fixWebmDuration } from './webm-duration-fix.js';

// Continuous recognition often re-finalizes the same in-progress utterance
// several times as it grows (or as ASR revises earlier words) before the
// chef actually pauses. Each of those would otherwise land as its own
// transcript segment -- and a run-on sentence with no natural pause can turn
// into a dozen overlapping segments that all get parsed independently,
// producing duplicated/garbled ingredients. When a newly committed segment
// is textually a continuation or revision of the immediately previous one
// (either one contains the other), it should replace that segment instead of
// appending a new one, keeping whichever version carries more measurement
// evidence -- the same "changes its mind" guarantee interim updates already
// get, extended to cross-commit revisions. previousKey/newKey are normalized
// (lowercased, whitespace-collapsed) text keys, not display text.
export function reconcileTranscriptSegment(previousKey, newKey) {
  if (!previousKey || previousKey === newKey) return previousKey === newKey ? 'skip' : 'append';
  const isRevision = newKey.includes(previousKey) || previousKey.includes(newKey);
  if (!isRevision) return 'append';
  return measurementEvidenceCount(previousKey) > measurementEvidenceCount(newKey) ? 'skip' : 'replace';
}

export class VoiceCapture {
  constructor({onSegment=()=>{},onPartial=()=>{},onStatus=()=>{}}={}) {
    this.onSegment=onSegment; this.onPartial=onPartial; this.onStatus=onStatus;
    this.stream=null; this.recorder=null; this.chunks=[]; this.recognition=null; this.running=false;
    this.startedAt=0; this.lastPartial=''; this.lastFinal=''; this.currentSegmentId=null; this.restartTimer=null; this.audioBlob=null;
  }

  get recognitionSupported(){return !!(window.SpeechRecognition||window.webkitSpeechRecognition);}
  get recordingSupported(){return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);}

  async start(){
    if(this.running) return true;
    if(!this.recordingSupported) throw new Error('This browser cannot record microphone audio.');
    this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    this.chunks=[]; this.audioBlob=null; this.startedAt=Date.now(); this.running=true; this.lastPartial=''; this.lastFinal=''; this.currentSegmentId=null;
    // audio/mp4 first would let a Chrome/Android build that now reports it as
    // supported win over WebM/Opus -- ChefVoice Review's Chirp 3 backend reliably
    // auto-detects WEBM_OPUS but has been seen to reject a MediaRecorder MP4/AAC
    // file outright ("does not appear to be in a supported encoding"). audio/mp4
    // stays last as the Safari/iOS fallback, since WebKit's MediaRecorder never
    // reports WebM as supported.
    const preferred=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported?.(t));
    this.recorder=new MediaRecorder(this.stream,preferred?{mimeType:preferred}:undefined);
    this.recorder.ondataavailable=e=>{if(e.data?.size)this.chunks.push(e.data);};
    this.recorder.start(1000);
    if(this.recognitionSupported){ this.onStatus('Listening continuously…'); this.#startRecognition(); }
    else this.onStatus('Recording your chef voice. Live transcription is unavailable in this browser; you can paste/edit the transcript after capture.');
    return true;
  }

  async stop(){
    if(!this.running) return {audioBlob:this.audioBlob,transcript:[]};
    this.running=false; clearTimeout(this.restartTimer);
    if(this.lastPartial) this.#commit(this.lastPartial);
    try{this.recognition?.stop();}catch{}
    const blobPromise=new Promise(resolve=>{
      if(!this.recorder||this.recorder.state==='inactive') return resolve(new Blob(this.chunks,{type:this.recorder?.mimeType||'audio/webm'}));
      this.recorder.addEventListener('stop',()=>resolve(new Blob(this.chunks,{type:this.recorder.mimeType||'audio/webm'})),{once:true});
      this.recorder.stop();
    });
    let recorded=await blobPromise;
    // Chrome's MediaRecorder writes WebM with no real duration in its header
    // (see webm-duration-fix.js) -- confirmed server-side (Cloud Function logs)
    // as the cause of both a client/server duration mismatch and an outright
    // "unsupported encoding" rejection from the Chirp 3 backend. Patch it here,
    // once, so every downstream consumer (local playback, ChefVoice Review
    // upload, publish-time voice clip upload) sees a normal, statically-valid
    // WebM file instead of one only the recording browser can make sense of.
    if(String(recorded.type||'').includes('webm')){
      recorded=await fixWebmDuration(recorded,Date.now()-this.startedAt,{logger:false});
    }
    this.audioBlob=recorded;
    this.stream?.getTracks().forEach(t=>t.stop()); this.stream=null;
    this.onPartial(''); this.onStatus('Capture complete. Building the recipe draft…');
    return {audioBlob:this.audioBlob};
  }

  #startRecognition(delay=0){
    clearTimeout(this.restartTimer);
    this.restartTimer=setTimeout(()=>{
      if(!this.running) return;
      const Ctor=window.SpeechRecognition||window.webkitSpeechRecognition;
      if(!Ctor) return;
      const r=new Ctor(); this.recognition=r;
      r.continuous=true; r.interimResults=true; r.maxAlternatives=3; r.lang=document.documentElement.lang||navigator.language||'en-US';
      r.onresult=e=>{
        for(let i=e.resultIndex;i<e.results.length;i++){
          const result=e.results[i]; const best=this.#bestAlternative(result); const text=normalizeSpeechText(best).trim(); if(!text)continue;
          if(result.isFinal){this.#commit(text);this.lastPartial='';this.onPartial('');}
          else {
            if(this.lastPartial && containsMeasurementEvidence(this.lastPartial) && !containsMeasurementEvidence(text)) this.#commit(this.lastPartial);
            this.lastPartial=text; this.onPartial(text);
          }
        }
      };
      r.onerror=e=>{
        if(!this.running)return;
        if(e.error==='not-allowed'||e.error==='service-not-allowed') this.onStatus('Microphone recording continues, but browser speech recognition was blocked.');
        else this.onStatus('Voice is still recording. Reconnecting live transcription…');
      };
      r.onend=()=>{ if(this.running) this.#startRecognition(250); };
      try{r.start();}catch{if(this.running)this.#startRecognition(700);}
    },delay);
  }

  #bestAlternative(result){
    const choices=[]; for(let i=0;i<result.length;i++) if(result[i]?.transcript) choices.push(result[i].transcript);
    if(!choices.length)return '';
    return choices.sort((a,b)=>measurementEvidenceCount(b)-measurementEvidenceCount(a))[0];
  }

  #commit(raw){
    const text=normalizeSpeechText(raw).trim(); if(!text)return;
    const key=text.toLowerCase().replace(/\s+/g,' ');
    const decision=this.currentSegmentId?reconcileTranscriptSegment(this.lastFinal,key):'append';
    if(decision==='skip')return;
    if(decision==='append') this.currentSegmentId=crypto.randomUUID();
    this.lastFinal=key;
    this.onSegment({id:this.currentSegmentId,elapsedMs:Math.max(0,Date.now()-this.startedAt),text:text[0].toUpperCase()+text.slice(1)});
  }

  close(){ clearTimeout(this.restartTimer); this.running=false; try{this.recognition?.abort();}catch{} this.stream?.getTracks().forEach(t=>t.stop()); }
}
