const { useState, useEffect, useRef, useMemo, useCallback } = React;

    // ── Utilities ──────────────────────────────────────────────────────────────
    const parseRestSec = r => {
      if (!r) return 90;
      const m = r.match(/(\d+(?:\.\d+)?)\s*min/);
      if (m) return Math.round(parseFloat(m[1]) * 60);
      const s = r.match(/(\d+)s/);
      if (s) return parseInt(s[1]);
      return 90;
    };
    const fmtTime = s => s <= 0 ? "0:00" : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
    const fmtMin = s => { const m = Math.floor(s/60); const rem = s%60; return rem > 0 ? `${m}m ${rem}s` : `${m} min`; };
    const uid = () => {
      try { return crypto.randomUUID(); }
      catch { return Math.random().toString(36).slice(2,9) + Date.now().toString(36); }
    };
    const getThemeColor = (rawColor, th) => {
      const t = th || document.documentElement.getAttribute('data-theme');
      return t === 'anti-red' ? 'var(--accent)' : rawColor;
    };
    // Hex → "r,g,b" for rgba() construction
    const hexToRgbStr = hex => {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||"");
      return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : null;
    };
    // ── App accent palette (single fixed accent, user-choosable) ──
    const ACCENT_PALETTES = [
      {id:"teal",   name:"Teal",   color:"#16d6a4"},
      {id:"violet", name:"Violet", color:"#9b7bff"},
      {id:"amber",  name:"Amber",  color:"#ffb020"},
      {id:"coral",  name:"Coral",  color:"#ff6b5e"},
      {id:"azure",  name:"Azure",  color:"#3a9bff"},
      {id:"lime",   name:"Lime",   color:"#9ae600"},
      {id:"rose",   name:"Rose",   color:"#ff5d8f"},
      {id:"gold",   name:"Gold",   color:"#ffd700"},
    ];
    const applyAppAccent = color => {
      try {
        const root = document.documentElement;
        if (!color) { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-muted'); root.style.removeProperty('--accent-rgb'); return; }
        const rgb = hexToRgbStr(color);
        root.style.setProperty('--accent', color);
        if (rgb) { root.style.setProperty('--accent-muted', `rgba(${rgb},0.15)`); root.style.setProperty('--accent-rgb', rgb); }
      } catch {}
    };
    // Apply saved accent as early as possible (before first paint of App)
    try {
      const savedAccent = (() => { try { return JSON.parse(localStorage.getItem('app_accent')); } catch { return null; } })();
      const th = (() => { try { return JSON.parse(localStorage.getItem('workout_theme')); } catch { return 'dark'; } })();
      if (savedAccent && th !== 'anti-red') applyAppAccent(savedAccent);
    } catch {}
    // CSS-variable override: everything inside a container (badges, chips, chevrons,
    // checkboxes, charts…) follows the custom accent for true colour consistency.
    const accentVars = color => {
      if (!color || typeof color !== "string" || color.startsWith("var(")) return {};
      const rgb = hexToRgbStr(color);
      const v = {"--accent":color};
      if (rgb) {
        v["--accent-muted"]=`rgba(${rgb},0.15)`;
        v["--accent-rgb"]=rgb;
        v["--timer-circle-bg"]=`rgba(${rgb},0.18)`;
      }
      return v;
    };
    // IndexedDB mirror — second copy of every write, restored if localStorage is wiped
    const idb = {
      db: null,
      open(){return new Promise(res=>{try{const r=indexedDB.open('workout_flow',1);r.onupgradeneeded=()=>{try{r.result.createObjectStore('kv');}catch{}};r.onsuccess=()=>{idb.db=r.result;res(r.result);};r.onerror=()=>res(null);}catch{res(null);}});},
      set(k,v){try{if(!idb.db)return;idb.db.transaction('kv','readwrite').objectStore('kv').put(v,k);}catch{}},
      remove(k){try{if(!idb.db)return;idb.db.transaction('kv','readwrite').objectStore('kv').delete(k);}catch{}},
      getAll(){return new Promise(res=>{try{if(!idb.db)return res({});const st=idb.db.transaction('kv','readonly').objectStore('kv');const out={};const req=st.openCursor();req.onsuccess=e=>{const c=e.target.result;if(c){out[c.key]=c.value;c.continue();}else res(out);};req.onerror=()=>res({});}catch{res({});}});}
    };
    const store = {
      get:(k,d)=>{try{const v=localStorage.getItem(k);if(!v)return d;const p=JSON.parse(v);if(Array.isArray(d)&&!Array.isArray(p))return d;if(d&&typeof d==='object'&&!Array.isArray(d)){if(typeof p!=='object'||p===null||Array.isArray(p))return d;return{...d,...p};}return p;}catch{return d;}},
      set:(k,v)=>{try{const s=JSON.stringify(v);localStorage.setItem(k,s);idb.set(k,s);}catch{}},
    };
    // Full backup: every key in one JSON file
    const exportAllData = () => {
      try {
        const data = {};
        for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i);data[k]=localStorage.getItem(k);}
        const blob = new Blob([JSON.stringify({app:"workout-flow",exported:new Date().toISOString(),data},null,2)],{type:"application/json"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `workout-backup-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        store.set('backup_meta',{last:new Date().toISOString(),sinceWorkouts:0});
        return true;
      } catch { return false; }
    };
    const importAllData = json => {
      try {
        const parsed = JSON.parse(json);
        const data = parsed && parsed.data ? parsed.data : parsed;
        if (!data || typeof data !== 'object') return false;
        Object.keys(data).forEach(k=>{try{const v=typeof data[k]==='string'?data[k]:JSON.stringify(data[k]);localStorage.setItem(k,v);idb.set(k,v);}catch{}});
        return true;
      } catch { return false; }
    };
    const bumpBackupCounter = () => {
      const m = store.get('backup_meta',{last:null,sinceWorkouts:0});
      store.set('backup_meta',{...m,sinceWorkouts:(m.sinceWorkouts||0)+1});
    };
    const numOnly = v => String(v??"").replace(/[^\d]/g, '');
    const decOnly = v => { let s = String(v??"").replace(/[^\d.]/g, ''); const i = s.indexOf('.'); return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, ''); };
    const parseWeight = str => { if (!str) return 0; const n = parseFloat(String(str).replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };
    const parseReps = str => { if (!str) return 0; const n = parseInt(String(str).replace(/[^\d]/g, '')); return isNaN(n) ? 0 : n; };
    const parseRepRange = str => {
      if (!str) return { min: 0, max: 0 };
      const m = String(str).match(/(\d+)\s*[-–]\s*(\d+)/);
      if (m) return { min: parseInt(m[1]), max: parseInt(m[2]) };
      const s = parseInt(String(str).replace(/[^\d]/g, ''));
      return { min: s || 0, max: s || 0 };
    };
    const calc1RM = (w, r) => { const wt = parseWeight(w); const rp = parseReps(r); if (!wt || !rp) return 0; return Math.round(wt * (1 + rp / 30) * 10) / 10; };
    const fmtWeight = w => { const n = parseWeight(w); return n ? `${n}kg` : 'BW'; };
    const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

    // ── Performance Utilities ─────────────────────────────────────────────────
    const getExerciseHistory = (exerciseId) => {
      const all = store.get("workout_progression", []);
      return all.filter(p => (p.exerciseId || p.exercise) === exerciseId || p.exercise === exerciseId).sort((a, b) => {
        const da = new Date(a.date), db = new Date(b.date);
        return db - da;
      });
    };

    const getLastPerformance = (exerciseId, exerciseName) => {
      const all = store.get("workout_progression", []);
      const matching = all.filter(p => p.exerciseId === exerciseId || p.exercise === exerciseName || p.exercise === exerciseId);
      if (!matching.length) return null;
      const sorted = matching.sort((a, b) => new Date(b.date) - new Date(a.date));
      return sorted[0];
    };

    const getBestPerformance = (exerciseId, exerciseName) => {
      const all = store.get("workout_progression", []);
      const matching = all.filter(p => p.exerciseId === exerciseId || p.exercise === exerciseName || p.exercise === exerciseId);
      if (!matching.length) return null;
      let bestWeight = null, bestReps = null, best1RM = null;
      matching.forEach(p => {
        const w = parseWeight(p.weight), r = parseReps(p.reps), rm = calc1RM(p.weight, p.reps);
        if (!bestWeight || w > parseWeight(bestWeight.weight)) bestWeight = p;
        if (!bestReps || r > parseReps(bestReps.reps)) bestReps = p;
        if (!best1RM || rm > calc1RM(best1RM.weight, best1RM.reps)) best1RM = p;
      });
      return { bestWeight, bestReps, best1RM };
    };

    const checkForPRs = (exerciseId, exerciseName, newWeight, newReps) => {
      const prs = [];
      const best = getBestPerformance(exerciseId, exerciseName);
      if (!best) return ['first'];
      const nw = parseWeight(newWeight), nr = parseReps(newReps), n1rm = calc1RM(newWeight, newReps);
      if (nw > 0 && nw > parseWeight(best.bestWeight?.weight)) prs.push('weight');
      if (nr > 0 && nr > parseReps(best.bestReps?.reps)) prs.push('reps');
      if (n1rm > 0 && n1rm > calc1RM(best.best1RM?.weight, best.best1RM?.reps)) prs.push('1rm');
      return prs;
    };

    const calculateStreaks = () => {
      const logs = store.get("workout_logs", []);
      if (!logs.length) return { current: 0, longest: 0 };
      const dates = [...new Set(logs.filter(l => l.completed > 0).map(l => l.date))].sort();
      if (!dates.length) return { current: 0, longest: 0 };
      let longest = 1, current = 1;
      // Calculate longest
      for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i-1]), curr = new Date(dates[i]);
        const diff = Math.round((curr - prev) / 86400000);
        if (diff === 1) { current++; longest = Math.max(longest, current); }
        else if (diff > 1) current = 1;
      }
      longest = Math.max(longest, current);
      // Calculate current streak from today backwards
      const today = todayStr();
      const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
      if (!dates.includes(today) && !dates.includes(yesterday)) return { current: 0, longest };
      let streak = 0;
      const startDate = dates.includes(today) ? new Date(today) : new Date(yesterday);
      for (let d = new Date(startDate); ; d.setDate(d.getDate() - 1)) {
        const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (dates.includes(ds)) streak++;
        else break;
        if (streak > 365) break;
      }
      return { current: streak, longest };
    };

    const getProgressionSuggestion = (exerciseId, exerciseName, targetReps) => {
      const last = getLastPerformance(exerciseId, exerciseName);
      if (!last) return null;
      const range = parseRepRange(targetReps);
      if (!range.max) return null;
      const lastReps = parseReps(last.reps);
      const lastWeight = parseWeight(last.weight);
      if (!lastWeight) return null;
      if (lastReps >= range.max) {
        return { type: 'up', weight: lastWeight + 2.5, reps: `${range.min}-${range.max}`, msg: `↑ ${lastWeight + 2.5}kg` };
      } else if (lastReps >= range.min) {
        return { type: 'same', weight: lastWeight, reps: `${range.min}-${range.max}`, msg: `${lastWeight}kg — aim for more reps` };
      } else if (lastReps < range.min - 3 && lastWeight > 5) {
        return { type: 'down', weight: Math.max(0, lastWeight - 2.5), reps: `${range.min}-${range.max}`, msg: `↓ ${lastWeight - 2.5}kg` };
      } else {
        return { type: 'same', weight: lastWeight, reps: `${range.min}-${range.max}`, msg: `Keep ${lastWeight}kg` };
      }
    };

    // ── Data Migration ────────────────────────────────────────────────────────
    const NAME_TO_ID = {};
    const buildNameIdMap = (sections) => {
      sections.forEach(sec => {
        if (sec.exercises) sec.exercises.forEach(ex => { if (ex.id) NAME_TO_ID[ex.name] = ex.id; });
        if (sec.sessions) sec.sessions.forEach(sess => sess.exercises.forEach(ex => { if (ex.id) NAME_TO_ID[ex.name] = ex.id; }));
      });
    };

    const migrateData = () => {
      const version = store.get("data_version", 0);
      if (version >= 2) return;
      // Migrate workout_progression: add exerciseId field
      const prog = store.get("workout_progression", []);
      let changed = false;
      prog.forEach(p => {
        if (!p.exerciseId && p.exercise && NAME_TO_ID[p.exercise]) {
          p.exerciseId = NAME_TO_ID[p.exercise];
          changed = true;
        }
      });
      if (changed) store.set("workout_progression", prog);
      // Migrate workout_weights: name keys → id keys
      const weights = store.get("workout_weights", {});
      const newWeights = {};
      let wChanged = false;
      Object.entries(weights).forEach(([k, v]) => {
        if (NAME_TO_ID[k]) { newWeights[NAME_TO_ID[k]] = v; wChanged = true; }
        else newWeights[k] = v;
      });
      if (wChanged) store.set("workout_weights", newWeights);
      // Migrate workout_reps
      const reps = store.get("workout_reps", {});
      const newReps = {};
      let rChanged = false;
      Object.entries(reps).forEach(([k, v]) => {
        if (NAME_TO_ID[k]) { newReps[NAME_TO_ID[k]] = v; rChanged = true; }
        else newReps[k] = v;
      });
      if (rChanged) store.set("workout_reps", newReps);
      // Migrate workout_notes
      const notes = store.get("workout_notes", {});
      const newNotes = {};
      let nChanged = false;
      Object.entries(notes).forEach(([k, v]) => {
        if (NAME_TO_ID[k]) { newNotes[NAME_TO_ID[k]] = v; nChanged = true; }
        else newNotes[k] = v;
      });
      if (nChanged) store.set("workout_notes", newNotes);
      store.set("data_version", 2);
    };

    // ── Audio ──────────────────────────────────────────────────────────────────
    // Primary path: pre-rendered WAV tones via HTMLAudio — reliable on iOS and
    // mixes OVER background music instead of pausing it. WebAudio synth kept as fallback.
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
    const TONES = {
      'tick':       {f:[440],d:0.05,t:'triangle',v:0.15},
      'beep-high':  {f:[880],d:0.12,t:'sine',v:0.2},
      'rest-chime': {f:[392,523.25],d:0.4,t:'sine',v:0.15},
      'chime':      {f:[523.25,659.25,783.99],d:0.6,t:'sine',v:0.2},
      'pr-fanfare': {f:[523.25,659.25,783.99,1046.5],d:0.8,t:'sine',v:0.25},
    };
    const renderWav = ({f,d,t,v}) => {
      const sr=22050;
      const total=Math.ceil(((f.length-1)*0.1+d+0.05)*sr);
      const data=new Float32Array(total);
      f.forEach((freq,idx)=>{
        const start=Math.floor(idx*0.1*sr), len=Math.floor(d*sr);
        for(let i=0;i<len&&start+i<total;i++){
          const tt=i/sr;
          const phase=2*Math.PI*freq*tt;
          const wave=t==='triangle'?(2/Math.PI)*Math.asin(Math.sin(phase)):Math.sin(phase);
          const gain=v*Math.pow(0.0001/v,tt/d);
          data[start+i]+=wave*gain;
        }
      });
      const buf=new ArrayBuffer(44+total*2); const dv=new DataView(buf);
      const ws=(o,s)=>{for(let i=0;i<s.length;i++)dv.setUint8(o+i,s.charCodeAt(i));};
      ws(0,'RIFF');dv.setUint32(4,36+total*2,true);ws(8,'WAVE');ws(12,'fmt ');
      dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,1,true);
      dv.setUint32(24,sr,true);dv.setUint32(28,sr*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);
      ws(36,'data');dv.setUint32(40,total*2,true);
      for(let i=0;i<total;i++){const s=Math.max(-1,Math.min(1,data[i]));dv.setInt16(44+i*2,s<0?s*0x8000:s*0x7FFF,true);}
      let bin='';const bytes=new Uint8Array(buf);
      for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
      return 'data:audio/wav;base64,'+btoa(bin);
    };
    const toneAudio = {};
    const getToneAudio = key => {
      if (!TONES[key]) return null;
      if (!toneAudio[key]) {
        try { const a = new Audio(renderWav(TONES[key])); a.preload = 'auto'; toneAudio[key] = a; } catch { return null; }
      }
      return toneAudio[key];
    };
    let audioUnlocked = false;
    // Prime ONE HTMLAudio element per tone (silent) within a gesture. We deliberately
    // play only a single element first (iOS allows one play() per gesture reliably),
    // then prime the rest opportunistically.
    const primeWavElements = () => {
      Object.keys(TONES).forEach(k => {
        const a = getToneAudio(k);
        if (!a) return;
        try {
          a.muted = true;
          const p = a.play();
          if (p && p.then) p.then(() => { try { a.pause(); a.currentTime = 0; } catch {} a.muted = false; }).catch(() => { a.muted = false; });
          else { a.muted = false; }
        } catch { a.muted = false; }
      });
    };
    const unlockAudio = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      primeWavElements();
    };

    // WebAudio synth — primary on most devices; also used to force-unlock with a silent buffer
    let synthCtx = null;
    const freshCtx = () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (synthCtx && synthCtx.state !== 'closed') return synthCtx;
        synthCtx = new AC();
        try {
          synthCtx.onstatechange = () => {
            if (synthCtx && (synthCtx.state === 'suspended' || synthCtx.state === 'interrupted')) synthCtx.resume().catch(()=>{});
          };
        } catch {}
        return synthCtx;
      } catch { return null; }
    };
    const unlockSynth = () => {
      unlockAudio();
      try {
        const ctx = freshCtx();
        if (!ctx) return;
        if (ctx.state !== 'running') ctx.resume().catch(()=>{});
        // Silent buffer kick — this is what actually flips iOS WebAudio to "running"
        try {
          const b = ctx.createBuffer(1, 1, 22050);
          const s = ctx.createBufferSource();
          s.buffer = b; s.connect(ctx.destination); s.start(0);
        } catch {}
      } catch {}
    };
    window.addEventListener('pointerdown', unlockSynth, {passive:true});
    window.addEventListener('touchstart',  unlockSynth, {passive:true});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') unlockSynth();
    });
    const playSynthTone = (freqs, duration, type='sine', volume=0.1) => {
      const playOn = ctx => freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const at = ctx.currentTime + idx*0.1;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = type; osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(volume, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.start(at);
        osc.stop(at + duration);
      });
      const rebuildAndPlay = () => {
        try { if (synthCtx) synthCtx.close().catch(()=>{}); } catch {}
        synthCtx = null;
        const c2 = freshCtx();
        if (!c2) return;
        if (c2.state === 'running') { try { playOn(c2); } catch {} return; }
        c2.resume().then(() => { try { playOn(c2); } catch {} }).catch(() => { try { playOn(c2); } catch {} });
      };
      try {
        const ctx = freshCtx();
        if (!ctx) return;
        if (ctx.state === 'running') { playOn(ctx); return; }
        ctx.resume().then(() => {
          if (ctx.state === 'running') playOn(ctx);
          else rebuildAndPlay();
        }).catch(rebuildAndPlay);
      } catch {}
    };
    // Play a named tone. Synth first (most reliable, respects no "one play per gesture"
    // limit and works after unlock), HTMLAudio WAV as fallback.
    const playTone = key => {
      const s = TONES[key];
      // Try synth path when a context is available and running.
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && s) {
          const ctx = freshCtx();
          if (ctx && ctx.state === 'running') { playSynthTone(s.f, s.d, s.t, s.v); return; }
        }
      } catch {}
      // Fallback: pre-rendered WAV element.
      const a = getToneAudio(key);
      if (a) {
        try {
          const inst = (a.paused || a.ended) ? a : a.cloneNode();
          inst.currentTime = 0;
          const p = inst.play();
          if (p && p.catch) p.catch(() => { if (s) playSynthTone(s.f, s.d, s.t, s.v); });
          return;
        } catch {}
      }
      if (s) playSynthTone(s.f, s.d, s.t, s.v);
    };
    const triggerSound = type => {
      unlockSynth();
      playTone(type);
    };
    const SOUND_LIST = [
      {key:'tick',label:'Tick',desc:'Rep count',f:[440],d:0.05,t:'triangle',v:0.15},
      {key:'beep-high',label:'Beep',desc:'Side switch',f:[880],d:0.12,t:'sine',v:0.2},
      {key:'rest-chime',label:'Rest',desc:'Rest start',f:[392,523.25],d:0.4,t:'sine',v:0.15},
      {key:'chime',label:'Done',desc:'Set done',f:[523.25,659.25,783.99],d:0.6,t:'sine',v:0.2},
    ];
    const triggerSoundChecked = type => {
      if (store.get('sound_master_off', false)) return;
      unlockSynth();
      const active = store.get('workout_active_sounds',{tick:true,'rest-chime':true,chime:true,'beep-high':true});
      if (!active[type]) return;
      playTone(type);
    };
    // Best-effort alert when any timer ends (rest OR a hold). Vibration fires even
    // in-app; the OS notification only shows when the app is backgrounded (an OS limit).
    const notifyTimerEnd = (title, body) => {
      try {
        if (!store.get('notify_rest_enabled', false)) return;
        try { navigator.vibrate?.([70,40,70]); } catch {}
        if (document.visibilityState === 'visible') return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const t = title || 'Timer done', b = body || 'Time for your next set';
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg=>reg.showNotification(t,{body:b,tag:'timer-end',renotify:true})).catch(()=>{ try{ new Notification(t,{body:b}); }catch{} });
        } else {
          try { new Notification(t,{body:b}); } catch {}
        }
      } catch {}
    };

    function NotifyToggle() {
      const [on,setOn]=useState(()=>store.get('notify_rest_enabled',false));
      const flip=async()=>{
        if(on){ setOn(false); store.set('notify_rest_enabled',false); return; }
        try{
          if(!('Notification' in window)){alert('Notifications are not supported on this device/browser.');return;}
          let perm=Notification.permission;
          if(perm==='default') perm=await Notification.requestPermission();
          if(perm!=='granted'){
            alert('Your browser blocked notifications. Enable them for this site in your browser settings, then try again.');
            return;
          }
          setOn(true); store.set('notify_rest_enabled',true);
        }catch{}
      };
      return (
        <div className="flex-between" style={{marginTop:"14px",alignItems:"center"}}>
          <span className="text-small" style={{display:"flex",alignItems:"center",gap:"7px"}}><Icons.Bell/> Notify when a timer ends</span>
          <button onClick={flip} role="switch" aria-checked={on} style={{width:"48px",height:"28px",borderRadius:"999px",flexShrink:0,position:"relative",
            background:on?"var(--accent)":"var(--input-bg)",border:`1.5px solid ${on?"var(--accent)":"var(--card-border)"}`,transition:"background 0.2s"}}>
            <span style={{position:"absolute",top:"2px",left:on?"22px":"2px",width:"20px",height:"20px",borderRadius:"50%",
              background:on?"var(--btn-text)":"var(--text-secondary)",transition:"left 0.2s"}}/>
          </button>
        </div>
      );
    }

    function DataBackupCard() {
      const [meta,setMeta]=useState(()=>store.get('backup_meta',{last:null,sinceWorkouts:0}));
      const fileRef=useRef(null);
      const daysSince=meta.last?Math.floor((Date.now()-new Date(meta.last).getTime())/86400000):null;
      const due=meta.last===null||(meta.sinceWorkouts||0)>=5||daysSince>7;
      const doExport=()=>{if(exportAllData())setMeta(store.get('backup_meta',{last:null,sinceWorkouts:0}));};
      const doImport=e=>{
        const f=e.target.files&&e.target.files[0];
        if(!f)return;
        const reader=new FileReader();
        reader.onload=()=>{
          if(!confirm("Restore backup? This overwrites current data."))return;
          if(importAllData(reader.result)){alert("Backup restored — reloading.");location.reload();}
          else alert("Could not read that backup file.");
        };
        reader.readAsText(f);
        e.target.value="";
      };
      return (
        <div className="card" style={due?{borderColor:"var(--warning)"}:{}}>
          <div className="flex-between">
            <p className="font-bold">Backups</p>
            {due&&<span className="badge" style={{background:"var(--warning-muted)",color:"var(--warning)",borderColor:"var(--warning)"}}>Backup due</span>}
          </div>
          <p className="text-small" style={{margin:"4px 0 10px"}}>
            {meta.last?`Last backup ${daysSince===0?"today":`${daysSince}d ago`} — ${meta.sinceWorkouts||0} workout${(meta.sinceWorkouts||0)===1?"":"s"} since`:"Never backed up. Phone storage can be wiped by the OS — keep a copy."}
          </p>
          <div style={{display:"flex",gap:"8px"}}>
            <button className="button-secondary" style={{padding:"9px",fontSize:"13px"}} onClick={doExport}><Icons.Download/> Export backup</button>
            <button className="button-secondary" style={{padding:"9px",fontSize:"13px"}} onClick={()=>fileRef.current&&fileRef.current.click()}><Icons.Upload/> Restore</button>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={doImport}/>
          </div>
        </div>
      );
    }

    function TimerConfigCard() {
      const [trans,setTrans]=useState(()=>String(store.get('workout_transition_sec',3)));
      const save=v=>{setTrans(v);const n=Math.max(1,Math.min(60,parseInt(v)||3));store.set('workout_transition_sec',n);};
      return (
        <div className="card">
          <p className="font-bold" style={{marginBottom:"2px"}}>Side-Switch Transition</p>
          <p className="text-small" style={{marginBottom:"10px"}}>Countdown between left/right sides</p>
          <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
            <input className="field" type="number" min="1" max="60" style={{marginBottom:0,width:"90px"}} value={trans} onChange={e=>save(e.target.value)}/>
            <span className="text-small">seconds</span>
          </div>
          <NotifyToggle/>
        </div>
      );
    }

    function SoundConfigCard() {
      const [sounds,setSounds] = useState(()=>store.get('workout_active_sounds',{tick:true,'rest-chime':true,chime:true,'beep-high':true}));
      const [masterOff,setMasterOff] = useState(()=>store.get('sound_master_off',false));
      const toggle = key => { const u={...sounds,[key]:!sounds[key]}; setSounds(u); store.set('workout_active_sounds',u); };
      const flipMaster = () => { const v=!masterOff; setMasterOff(v); store.set('sound_master_off',v); if(!v) unlockSynth(); };
      return (
        <div className="card">
          <div className="flex-between" style={{marginBottom:"10px"}}>
            <p className="font-bold">Sound Alerts</p>
            <button onClick={flipMaster} role="switch" aria-checked={!masterOff} title={masterOff?"Sounds off":"Sounds on"} style={{width:"48px",height:"28px",borderRadius:"999px",flexShrink:0,position:"relative",
              background:!masterOff?"var(--accent)":"var(--input-bg)",border:`1.5px solid ${!masterOff?"var(--accent)":"var(--card-border)"}`,transition:"background 0.2s"}}>
              <span style={{position:"absolute",top:"2px",left:!masterOff?"22px":"2px",width:"20px",height:"20px",borderRadius:"50%",background:!masterOff?"var(--btn-text)":"var(--text-secondary)",transition:"left 0.2s"}}/>
            </button>
          </div>
          <div style={{opacity:masterOff?0.4:1,pointerEvents:masterOff?"none":"auto"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
            {SOUND_LIST.map(({key,label,desc,f,d,t,v})=>(
              <button key={key} onClick={()=>toggle(key)} style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 12px",borderRadius:"10px",background:sounds[key]?"var(--accent-muted)":"var(--input-bg)",border:sounds[key]?"1.5px solid var(--accent)":"1.5px solid var(--card-border)",color:sounds[key]?"var(--accent)":"var(--text-secondary)",textAlign:"left"}}>
                <span style={{fontSize:"15px",width:"16px",flexShrink:0}}>{sounds[key]?"✓":"○"}</span>
                <div style={{flex:1}}><div style={{fontWeight:"700",fontSize:"13px"}}>{label}</div><div style={{fontSize:"11px",opacity:0.7}}>{desc}</div></div>
                <span style={{fontSize:"11px",opacity:0.5,padding:"2px 5px",borderRadius:"6px",background:"var(--input-bg)"}} onClick={e=>{e.stopPropagation();unlockSynth();playTone(key);}}>▶</span>
              </button>
            ))}
            </div>
          </div>
          <p className="text-small" style={{fontSize:"11px",marginTop:"10px",opacity:0.8}}>Tap ▶ to test. If you hear nothing on iPhone, flick the physical silent switch off — browsers can't play over it.</p>
        </div>
      );
    }

    // ── Global Wake Lock Manager (persists across tabs & during workouts) ──────
    let _wakeLock = null;
    let _wantWake = store.get('workout_keep_awake', false);
    const _wakeListeners = new Set();
    const _notifyWake = () => _wakeListeners.forEach(fn => { try { fn(_wantWake, !!_wakeLock); } catch {} });
    const acquireWake = async () => {
      try {
        if (!('wakeLock' in navigator) || !_wantWake || _wakeLock) return;
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => {
          _wakeLock = null; _notifyWake();
          if (_wantWake && document.visibilityState === 'visible') acquireWake();
        });
        _notifyWake();
      } catch {}
    };
    const releaseWake = async () => {
      try { if (_wakeLock) { const w = _wakeLock; _wakeLock = null; await w.release(); } } catch {}
      _notifyWake();
    };
    const setWantWake = v => { _wantWake = v; store.set('workout_keep_awake', v); if (v) acquireWake(); else releaseWake(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _wantWake) acquireWake(); });
    // Re-attempt acquisition on the first user gesture if the preference is already on
    const _wakeOnGesture = () => { if (_wantWake) acquireWake(); };
    window.addEventListener('pointerdown', _wakeOnGesture, { passive: true });
    window.addEventListener('touchstart', _wakeOnGesture, { passive: true });

    function WakeLockToggle() {
      const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
      const [on, setOn] = useState(_wantWake);
      const [active, setActive] = useState(!!_wakeLock);
      useEffect(() => {
        const fn = (want, isActive) => { setOn(want); setActive(isActive); };
        _wakeListeners.add(fn);
        return () => { _wakeListeners.delete(fn); };
      }, []);
      const toggle = () => { const v = !on; setOn(v); setWantWake(v); };
      const label = !supported ? "N/A" : (on ? "On" : "Off");
      return (
        <div className="card">
          <div className="flex-between">
            <div><p className="font-bold">Screen Wake Lock</p><p className="text-small">{supported ? "Keep screen on during workouts" : "Not supported on this browser"}</p></div>
            <button onClick={toggle} disabled={!supported} style={{opacity:supported?1:0.5,background:on?"var(--success-muted)":"var(--input-bg)",border:on?"1.5px solid var(--success)":"var(--border-thickness) solid var(--card-border)",borderRadius:"20px",padding:"6px 16px",fontSize:"13px",fontWeight:"700",color:on?"var(--success)":"var(--text)"}}>
              {label}
            </button>
          </div>
        </div>
      );
    }

    // ── Data ───────────────────────────────────────────────────────────────────
    const FB_SECTIONS = [
      {section:"Full Body",exercises:[
        {id:"fb-tricep-pushdown",name:"Tricep Pushdown",equip:"Cable (Single)",sets:1,reps:"7",weight:"18kg",rest:"90s",
         cue:"Elbows glued to your sides, full lockout, control the weight back up."},
        {id:"fb-one-arm-preacher",name:"One Arm Preacher Curl",equip:"Dumbbell (Single)",sets:1,reps:"4",weight:"24kg",rest:"90s",single:true,
         cue:"Armpit on the pad, full stretch at the bottom, no bounce."},
        {id:"fb-overhead-tri",name:"Overhead Triceps Extension",equip:"Cable (Single)",sets:1,reps:"8",weight:"32kg",rest:"90s",
         cue:"Elbows tucked by the ears, deep stretch behind the head, press to lockout."},
        {id:"fb-reverse-preacher",name:"Reverse Preacher Curl",equip:"EZ Bar",sets:1,reps:"6",weight:"40kg",rest:"90s",
         cue:"Overhand grip, wrists locked, control the descent."},
        {id:"fb-one-arm-lateral",name:"One Arm Lateral Raise",equip:"Cable (Single)",sets:1,reps:"5",weight:"17kg",rest:"60s",single:true,
         cue:"Cable behind the body, lead with the elbow, constant tension."},
        {id:"fb-chest-press",name:"Chest Press",equip:"Machine",sets:1,reps:"5",weight:"107kg",rest:"2 min",
         cue:"Handles at mid-chest, press and squeeze without slamming the stack."},
        {id:"fb-shoulder-press",name:"Shoulder Press",equip:"Machine",sets:1,reps:"7",weight:"59kg",rest:"90s",
         cue:"Back flat on the pad, press without shrugging the traps."},
        {id:"fb-front-raise",name:"Front Raise",equip:"Dumbbell (Double)",sets:1,reps:"8",weight:"16kg",rest:"60s",
         cue:"Raise to eye level, no swing, control the lowering."},
        {id:"fb-lat-pulldown",name:"Lat Pulldown",equip:"Cable (Single)",sets:1,reps:"5",weight:"100kg",rest:"2 min",
         cue:"Slight lean back, pull to upper chest, elbows down and in."},
        {id:"fb-reverse-fly",name:"Reverse Fly",equip:"Machine",sets:1,reps:"9",weight:"100kg",rest:"90s",
         cue:"Slight elbow bend held constant, sweep back, squeeze the rear delts."},
        {id:"fb-tbar-row",name:"T-Bar Row",equip:"Machine",sets:1,reps:"6",weight:"120kg",rest:"90s",
         cue:"Chest supported, drive the elbows back, squeeze the mid-back."},
        {id:"fb-shoulder-shrug",name:"Shoulder Shrug",equip:"Dumbbell (Double)",sets:1,reps:"6",weight:"46kg",rest:"60s",
         cue:"Straight up to the ears, 1s hold at the top, no rolling."},
        {id:"fb-low-row",name:"Low Row",equip:"Cable (Single)",sets:1,reps:"8",weight:"80kg",rest:"90s",
         cue:"Chest tall, pull to the belly button, squeeze the shoulder blades."},
        {id:"fb-hip-thrust",name:"Hip Thrust",equip:"Barbell",sets:1,reps:"5",weight:"130kg",rest:"2 min",hero:true,
         cue:"Shoulders on bench, chin tucked, drive hips to full lockout and squeeze glutes hard."},
        {id:"fb-hack-squat",name:"Hack Squat",equip:"Machine",sets:1,reps:"6",weight:"25kg",rest:"2 min",
         cue:"Back flat on the pad, feet mid-platform, deep controlled reps."},
        {id:"fb-seated-leg-curl",name:"Seated Leg Curl",equip:"Machine",sets:1,reps:"7",weight:"88kg",rest:"90s",
         cue:"Hips pinned, full squeeze, slow controlled return."},
        {id:"fb-leg-extension",name:"Leg Extensions",equip:"Machine",sets:1,reps:"7",weight:"80kg",rest:"90s",
         cue:"Pause 1s at the top, control the negative."},
        {id:"fb-calf-press",name:"Calf Press Machine",equip:"Machine",sets:1,reps:"7",weight:"145kg",rest:"90s",
         cue:"Full stretch at the bottom, pause, drive all the way to the toes."},
        {id:"fb-inner-thigh",name:"Inner Thigh Machine",equip:"Machine",sets:1,reps:"5",weight:"79kg",rest:"60s",
         cue:"Squeeze in smoothly, resist the return."},
        {id:"fb-outer-thigh",name:"Outer Thigh Machine",equip:"Machine",sets:1,reps:"7",weight:"79kg",rest:"60s",
         cue:"Tall posture, push out with control, pause at the widest point."},
        {id:"fb-core-twist",name:"Core Twist",equip:"Band",sets:1,reps:"8",weight:"82kg",rest:"60s",
         cue:"Controlled rotation, resist the momentum on the return."},
        {id:"fb-ab-crunch",name:"Ab Crunch Machine",equip:"Machine",sets:1,reps:"8",weight:"118kg",rest:"60s",
         cue:"Ribs to hips, not the neck, slow return."},
        {id:"fb-back-extension",name:"Back Extension",equip:"Bodyweight",sets:2,reps:"7",weight:"60kg",rest:"60s",
         cue:"Hinge at the hip to a deep hamstring stretch, drive to parallel \u2014 don't hyperextend."},
        {id:"fb-wrist-curl",name:"Wrist Curl",equip:"Band",sets:1,reps:"8",weight:"40kg",rest:"45s",
         cue:"Forearm fully supported, wrist only, slow and full range."},
        {id:"fb-reverse-wrist-curl",name:"Reverse Wrist Curl",equip:"Band",sets:1,reps:"8",weight:"20kg",rest:"45s",
         cue:"Overhand grip, wrist only, full range, slow eccentric."},
      ]},
      {section:"Arms",exercises:[
        {id:"ex-overhead-tri",name:"Overhead Triceps Extension",equip:"Cable",sets:2,reps:"8-12",weight:"",rest:"2 min",hero:true,
         cue:"Do this completely fresh. Both hands on rope, elbows above head. Lower behind head to full long-head stretch. Press to lockout. Max effort."},
        {id:"ex-tri-pushdown",name:"Tricep Pushdown",equip:"Cable Single",sets:1,reps:"10-12",weight:"",rest:"90s",
         cue:"Elbows pinned to sides. Full extension at bottom. Controlled return."},
        {id:"ex-bicep-curl",name:"Bicep Curl",equip:"Cable Single",sets:1,reps:"10-12",weight:"",rest:"90s",
         cue:"Full extension at bottom — cable keeps tension here. Curl to peak, slow negative."},
        {id:"ex-reverse-preacher",name:"Reverse Preacher Curl",equip:"EZ Bar",sets:1,reps:"10-12",weight:"",rest:"75s",
         cue:"Full extension at bottom. Overhand grip. Hits brachialis and brachioradialis. Slow."},
      ]},
      {section:"Push",exercises:[
        {id:"ex-chest-press",name:"Chest Press",equip:"Machine",sets:1,reps:"8-12",weight:"",rest:"2 min",
         cue:"One second pause at full stretch at the bottom. Drive to lockout. Don't bounce."},
        {id:"ex-shoulder-press",name:"Shoulder Press",equip:"Machine",sets:1,reps:"8-12",weight:"",rest:"90s",
         cue:"Full overhead lockout every rep. Don't cut the range at the top."},
        {id:"ex-lat-raise",name:"One Arm Lateral Raise",equip:"Cable Single",sets:1,reps:"12-15",weight:"",rest:"75s",
         cue:"Cable from low position. Arm across body at start — bottom is max stretch. No swinging."},
        {id:"ex-front-raise",name:"Front Raise",equip:"Dumbbell",sets:1,reps:"10-15",weight:"",rest:"60s",
         cue:"Control the eccentric. Raise to eye level. No momentum."},
      ]},
      {section:"Pull",exercises:[
        {id:"ex-lat-pulldown",name:"Lat Pulldown",equip:"Machine",sets:1,reps:"8-12",weight:"",rest:"2 min",
         cue:"Arms fully extended at top before every pull. Pull to upper chest, elbows drive down and back."},
        {id:"ex-back-row",name:"Back Row",equip:"Machine",sets:1,reps:"8-12",weight:"",rest:"2 min",
         cue:"Full arm extension before every rep. Drive elbows past your torso. Squeeze at peak."},
        {id:"ex-low-row",name:"Low Row",equip:"Cable Single",sets:1,reps:"10-12",weight:"",rest:"90s",
         cue:"Full stretch at start. Single arm — drive elbow back past hip."},
        {id:"ex-reverse-fly",name:"Reverse Fly",equip:"Machine",sets:1,reps:"12-15",weight:"",rest:"75s",
         cue:"Full stretch at start. Keep shoulders down. Squeeze at peak."},
        {id:"ex-shrug",name:"Shoulder Shrug",equip:"Dumbbell",sets:1,reps:"10-15",weight:"",rest:"60s",
         cue:"Full shoulder depression before every rep. Straight up — no rolling."},
      ]},
      {section:"Legs",exercises:[
        {id:"ex-hip-thrust",name:"Hip Thrust",equip:"Barbell",sets:1,reps:"6",weight:"120kg",rest:"2 min",
         cue:"Upper back on bench. One second pause at bottom. Drive to full hip extension — hard glute squeeze. Chin tucked."},
        {id:"ex-pendulum-squat",name:"Pendulum Squat",equip:"Machine",sets:1,reps:"5",weight:"25kg",rest:"2 min",
         cue:"Control descent to full depth. Drive through heels to lockout."},
        {id:"ex-leg-ext",name:"Leg Extensions",equip:"Machine",sets:1,reps:"10-12",weight:"",rest:"90s",
         cue:"Three second eccentric. Full extension at top."},
        {id:"ex-leg-curl",name:"Seated Leg Curl",equip:"Machine",sets:1,reps:"10-12",weight:"",rest:"90s",
         cue:"Full extension before every rep. Curl fully, control the negative."},
        {id:"ex-calf-raise",name:"Calf Raises",equip:"Machine",sets:1,reps:"7",weight:"140kg",rest:"75s",
         cue:"Deep stretch at the bottom of every rep. Non-negotiable. Full plantarflexion at top."},
        {id:"ex-inner-thigh",name:"Inner Thigh Machine",equip:"Machine",sets:1,reps:"10-12",weight:"",rest:"60s",
         cue:"Full abduction before squeezing in."},
        {id:"ex-outer-thigh",name:"Outer Thigh Machine",equip:"Machine",sets:1,reps:"6",weight:"79kg",rest:"60s",
         cue:"Start legs together. Full ROM outward. Control the return."},
      ]},
      {section:"Core + Prehab",exercises:[
        {id:"ex-core-twist",name:"Core Twist",equip:"Band",sets:1,reps:"12 each",weight:"",rest:"60s",
         cue:"Controlled rotation. Resist the momentum on the return."},
        {id:"ex-ab-crunch",name:"Ab Crunch Machine",equip:"Machine",sets:1,reps:"12-15",weight:"",rest:"60s",
         cue:"Ribs to hips — not neck. Slow return."},
        {id:"ex-back-ext",name:"Back Extension",equip:"Bodyweight",sets:1,reps:"12-15",weight:"",rest:"60s",
         cue:"Hinge at hip to deep hamstring stretch. Drive to parallel — don't hyperextend."},
        {id:"ex-int-shoulder",name:"Internal Shoulder Rotation",equip:"Cable Single",sets:1,reps:"12-15",weight:"",rest:"45s",
         cue:"Elbow at 90 degrees at side. Rotate inward. Light weight, full range."},
        {id:"ex-ext-shoulder",name:"External Shoulder Rotation",equip:"Cable Single",sets:1,reps:"12-15",weight:"",rest:"45s",
         cue:"Elbow at 90 degrees at side. Rotate outward. Keep upper arm still."},
        {id:"ex-wrist-curl",name:"Wrist Curl",equip:"Band",sets:1,reps:"15-20",weight:"",rest:"45s",
         cue:"Forearm fully supported. Wrist only. Slow and full range."},
        {id:"ex-rev-wrist-curl",name:"Reverse Wrist Curl",equip:"Band",sets:1,reps:"15-20",weight:"",rest:"45s",
         cue:"Overhand grip. Wrist only. Full range. Slow eccentric."},
      ]},
    ];

    const TENDON = {
      explosive:{label:"Power Plan",weeks:"~12 weeks",name:"Explosive + Tendon",color:"#ff453a",
        meta:"Explosive work first, when fresh. Order per day: warm-up → speed/jump/reactive → landing → tendon (iso/HSR) → then your normal full-body lift. Run the three days non-consecutively (e.g. Mon/Wed/Fri). The Warm-Up tab is shared — do it before every day, then add the day-specific ramp. Isos: progress by adding load, keep holds ~30-45s. Plyos/sprints: progress intensity, never rep count.",
        sessions:[
          {label:"Warm-Up",day:"Shared — do before every session",exercises:[
            {id:"wu-p1",name:"Phase 1 — Raise temperature",equip:"Warm-up",sets:1,reps:"~3 min",weight:"",rest:"0s",unilateral:false,cue:"Easy jog (bike instead on Day B). Light sweat, slightly raised heart rate. Don't go into drills cold."},
            {id:"wu-p2",name:"Phase 2 — Dynamic mobility",equip:"Warm-up",sets:1,reps:"~3 min",weight:"",rest:"0s",unilateral:false,cue:"Moving, not held: leg swings front-back 10/leg · side-to-side 10/leg · walking knee hugs 6/leg · heel-to-glute 6/leg · straight-leg kicks 6/leg · world's greatest stretch 4/side · knee-to-wall ankle rocks 8/leg · light ankle pogo bounces ×20."},
            {id:"wu-p3",name:"Phase 3 — Movement prep drills",equip:"Warm-up",sets:1,reps:"~3 min",weight:"",rest:"0s",unilateral:false,cue:"~15-20m each, walk back: A-skips ×2 (knee up, toe up) · high knees ×2 · butt kicks ×2 · carioca ×2 each way · straight-leg bounds ×1-2."},
            {id:"wu-p4",name:"Phase 4 — Day-specific ramp",equip:"Warm-up",sets:1,reps:"~2-3 min",weight:"",rest:"0s",unilateral:false,cue:"Day A: 2-3 build-up runs (30m, 60→80→95%) + 1-2 near-max efforts before accelerations. Day B: ankle hops 2×15, then 3-5 low pogos + 2-3 submax box step-off landings before depth jumps. Day C: carioca + lateral lunges + lateral pogos, 20-30s single-leg balance per leg, 2-3 submax bounds. No long static stretches before training."},
          ]},
          {label:"Day A",day:"Sprint / Achilles",exercises:[
            {id:"dA-warmup",name:"Warm-up (see Warm-Up tab)",equip:"Warm-up",sets:1,reps:"8-10 min",weight:"",rest:"0s",unilateral:false,cue:"Run the shared Warm-Up first. Day A ramp: 2-3 build-up runs (60→80→95%) + 1-2 near-max efforts before the working accelerations."},
            {id:"dA-accel",name:"Accelerations (20m)",equip:"Sprint",sets:6,metric:"distance",dist:"20m",effort:"~95%",reps:"20m",weight:"",rest:"2 min",cue:"~95% effort over 20m. Walk back between reps to fully recover. Progress sprint speed, never rep count — set ends the moment speed drops."},
            {id:"dA-flying",name:"Flying Sprints (15m run-in + 20m)",equip:"Sprint",sets:4,metric:"distance",dist:"20m",effort:"max",reps:"20m",weight:"",rest:"3 min",cue:"15m run-in to build speed, then 20m at max velocity. Full 3 min rest — this is quality, not conditioning."},
            {id:"dA-calf-iso",name:"Single-Leg Calf Raise Iso — Straight Knee",equip:"Single leg + load",sets:4,reps:"1",hold:"35s",weight:"+40kg",rest:"60s",single:true,cue:"Straight knee (gastrocnemius), mid-calf position, one leg, hold completely still under load. 35s per leg. Primary Achilles stiffness driver — progress by adding load, not time."},
            {id:"dA-soleus-iso",name:"Single-Leg Soleus Iso — Bent Knee",equip:"Single leg + load",sets:3,reps:"1",hold:"30s",weight:"+30kg",rest:"60s",single:true,cue:"Knee bent ~20-30° to bias the soleus. Hold mid-range under load, 30s per leg. Loads the deeper portion of the Achilles the straight-knee hold misses."},
            {id:"dA-lift",name:"→ then full-body lift",equip:"Note",sets:1,reps:"—",weight:"",rest:"0s",cue:"Now do your normal full-body lift session (in the Full Body section)."},
          ]},
          {label:"Day B",day:"Jump / Patellar + Landing",exercises:[
            {id:"dB-warmup",name:"Warm-up (see Warm-Up tab)",equip:"Warm-up",sets:1,reps:"8-10 min",weight:"",rest:"0s",unilateral:false,cue:"Run the shared Warm-Up first. Day B ramp: ankle hops 2×15, then 3-5 low pogos + 2-3 submax box step-off landings before depth jumps."},
            {id:"dB-snapdowns",name:"Snap Downs",equip:"Bodyweight",sets:3,reps:"5",weight:"Bodyweight",rest:"60s",cue:"Fast drop into an athletic stick position. Absorb and freeze. Teaches the landing mechanics before adding height."},
            {id:"dB-stick",name:"Stick Landings (drop ~30cm, freeze 3s)",equip:"Box ~30cm",sets:3,reps:"5",weight:"Bodyweight",rest:"60s",cue:"Drop from a ~30cm box, land, absorb, and freeze for 3 seconds. Build the landing before you add the rebound."},
            {id:"dB-depth",name:"Depth Jumps (~30cm box)",equip:"Box ~30cm",sets:4,reps:"4",weight:"Bodyweight",rest:"2 min",cue:"Step off (don't jump), land, instantly rebound up. Minimal ground contact. Progress box height, never reps."},
            {id:"dB-broad",name:"Broad Jumps",equip:"Bodyweight",sets:4,metric:"distance",dist:"best reach",effort:"max",reps:"",weight:"",rest:"90s",cue:"Maximal horizontal distance — log your best reach each set. Big arm drive, land soft. Walk back between reps."},
            {id:"dB-spanish",name:"Spanish Squat Iso",equip:"Band + plate",sets:4,reps:"1",hold:"40s",weight:"+20kg plate",rest:"60s",cue:"Band behind the knees, sit back against it, hold at ~90°. Patellar stiffness driver. Add load to progress."},
            {id:"dB-patellar-hsr",name:"Leg Extension HSR (optional patellar)",equip:"Machine",sets:3,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",unilateral:false,cue:"Optional patellar HSR — the preferred option. 3s down, 1s pause, 3s up at a true 6-8RM. Option B if a leg-ext machine isn't free: Split Squat HSR, 3×6-8 per leg, same tempo. Pick one, not both."},
            {id:"dB-lift",name:"→ then full-body lift",equip:"Note",sets:1,reps:"—",weight:"",rest:"0s",cue:"Now do your normal full-body lift session (in the Full Body section)."},
          ]},
          {label:"Day C",day:"Reactive / Unilateral + HSR",exercises:[
            {id:"dC-warmup",name:"Warm-up (see Warm-Up tab)",equip:"Warm-up",sets:1,reps:"8-10 min",weight:"",rest:"0s",unilateral:false,cue:"Run the shared Warm-Up first. Day C ramp: carioca + lateral lunges + lateral pogos, 20-30s single-leg balance per leg, 2-3 submax bounds/skater hops."},
            {id:"dC-linehops",name:"Single-Leg Line Hops",equip:"Bodyweight",sets:3,reps:"10 / direction",weight:"Bodyweight",rest:"60s",single:true,cue:"Fast hops over a line, stiff ankle. 10 each direction. Quick ground contacts — think hot floor."},
            {id:"dC-skater",name:"Lateral / Skater Bounds",equip:"Bodyweight",sets:3,metric:"distance",dist:"lateral distance",effort:"max",reps:"",weight:"",rest:"75s",cue:"Explosive push off one leg, land on the other, stick it. 4 per side. Reactive lateral power for combat."},
            {id:"dC-slbounds",name:"Single-Leg Bounds",equip:"Bodyweight",sets:3,metric:"distance",dist:"distance per bound",effort:"max",reps:"",weight:"",rest:"90s",single:true,cue:"Max distance per bound, controlled landing. 6 per leg."},
            {id:"dC-altbound",name:"Alternate-Leg Bounding (20m)",equip:"Bodyweight",sets:2,metric:"distance",dist:"20m",effort:"max",reps:"20m",weight:"",rest:"2 min",cue:"Explosive bounding over 20m, alternating legs. Walk back between reps."},
            {id:"dC-hsr-calf",name:"Heavy-Slow Calf Raise (HSR — only HSR input)",equip:"Machine/DB",sets:4,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",unilateral:false,cue:"Your ONLY HSR input — keep it genuinely heavy and strict. 3s down to stretch, 1s pause, 3s up. Drop tempo before you ever drop load."},
            {id:"dC-splitsquat-iso",name:"Split Squat Iso (patellar, 2nd angle)",equip:"Load",sets:3,reps:"1",hold:"30s",weight:"+15kg",rest:"60s",single:true,cue:"Hold the bottom of a split squat, 30s per side. Loads the patellar tendon at a second joint angle. Add load to progress."},
            {id:"dC-wallsit-iso",name:"Wall Sit Iso (patellar, 3rd angle)",equip:"Load",sets:3,reps:"1",hold:"45s",weight:"+20kg",rest:"60s",unilateral:false,cue:"Back flat on the wall, thighs parallel, plate held on the lap. Hold 45s. Third patellar angle for quad-tendon stiffness — keep it loaded, not bodyweight."},
            {id:"dC-lift",name:"→ then full-body lift",equip:"Note",sets:1,reps:"—",weight:"",rest:"0s",cue:"Now do your normal full-body lift session (in the Full Body section)."},
          ]},
        ]},
    };

    const STRETCHES = [
      {id:"st-cat-cow",name:"Cat-Cow",totalSec:60,sideLabels:[],muscles:["Spine","Core"],isDynamic:true,phases:{1:{dur:"60s",how:"On all-fours. Inhale and arch down (cow), exhale and round up (cat). Eight to ten slow rhythmic cycles. Keep moving."},2:{dur:"90s",how:"Same movement. Add a three-second hold at each end range before transitioning."},3:{dur:"60s",how:"Articulate one vertebra at a time through the spine. Active spinal segmentation."},4:{dur:"90s",how:"Add lateral flexion and gentle rotation. Explore the full three-dimensional movement of the spine."},5:{dur:"60s",how:"Daily movement prep. Move however feels right."}}},
      {id:"st-wgs",name:"World's Greatest Stretch",totalSec:120,sideLabels:["right side","left side"],muscles:["Hip flexors","Thoracic spine","Hips","Shoulders"],priority:true,phases:{1:{dur:"60s per side",how:"Deep lunge, same-side hand inside the front foot. Rotate top arm to ceiling and let eyes follow. Every exhale, drive the rear hip crease down."},2:{dur:"45s per side",how:"Same position. Add a three-second hold at the top of each rotation."},3:{dur:"45s per side",how:"At peak rotation, remove hand from floor and hold balance. Active thoracic control."},4:{dur:"60s",how:"Flow continuously through the full sequence. One movement."},5:{dur:"30s per side",how:"Movement prep. Use before any session."}}},
      {id:"st-low-lunge",name:"Low Lunge — Quad Focus",totalSec:120,sideLabels:["right side","left side"],muscles:["Quads","Hip flexors"],priority:true,phases:{1:{dur:"60s per side",how:"Back knee on floor. Grab the rear ankle, heel toward glute. Keep hips square. Feel it in the front of the rear thigh."},2:{dur:"60s per side",how:"At end range, press back knee into floor for five seconds (isometric). Exhale, relax, sink deeper. Three cycles per side."},3:{dur:"45s per side",how:"Lift the back foot toward your glute and hold there actively — no hands. End-range strength."},4:{dur:"60s",how:"Add thoracic rotation: rotate toward the front leg and open arm to ceiling."},5:{dur:"45s per side",how:"Maintenance. Hip flexors are historically tight — never skip this one."}}},
      {id:"st-butterfly",name:"Butterfly Stretch",totalSec:90,sideLabels:[],muscles:["Adductors","Groin","Inner thighs"],phases:{1:{dur:"90s",how:"Soles of feet together, knees wide. Hold feet, sit tall. Gently press knees toward floor with elbows."},2:{dur:"60s + PNF",how:"Press knees up against hands for five seconds. Exhale, let knees drop further. Three cycles."},3:{dur:"45s",how:"Without hands, lower knees through active hip external rotation. Hold lowest active position."},4:{dur:"60s",how:"Bring feet closer to groin progressively."},5:{dur:"45s",how:"Maintenance. Good for adductor health given your hip thrust volume."}}},
      {id:"st-figure4",name:"Figure-4 / 90-90",totalSec:90,sideLabels:["right hip","left hip"],muscles:["Glutes","Piriformis","Hip rotators"],phases:{1:{dur:"45s per side",how:"Figure-4: lie on back, cross ankle over thigh, draw legs toward chest. Or 90-90: sit with both hips at 90 degrees, lean forward over front shin."},2:{dur:"45s per side",how:"Press ankle into knee for five seconds (isometric). Exhale, pull closer. Three cycles per side."},3:{dur:"45s per side",how:"Progress to 90-90 seated. Rotate torso forward over front shin actively."},4:{dur:"60s",how:"Flow from figure-4 to 90-90 to forward lean. One exploration."},5:{dur:"45s per side",how:"Maintenance. Important given your hip thrust volume."}}},
      {id:"st-forward-fold",name:"Seated Forward Fold",totalSec:90,sideLabels:[],muscles:["Hamstrings","Lower back","Calves"],phases:{1:{dur:"90s",how:"Legs straight, hinge from hips — not mid-back. Long neutral spine first, depth second."},2:{dur:"60s + PNF",how:"Dig heels into floor (isometric) for five seconds. Exhale, fold deeper. Three cycles."},3:{dur:"45s",how:"At end range, actively pull chest closer using hip flexors — not gravity."},4:{dur:"60s",how:"Explore narrow, wide, and single leg variations. Find the tightest angle."},5:{dur:"45s",how:"Maintenance — hamstring baseline is already strong."}}},
      {id:"st-cobra",name:"Cobra Waves",totalSec:60,sideLabels:[],muscles:["Spine","Abs","Chest"],isDynamic:true,phases:{1:{dur:"60s / 5-7 waves",how:"Face down, hands under shoulders. Press slowly up into cobra, hold two to three seconds, lower, pause, rise again."},2:{dur:"60s / 8-10 waves",how:"Progressively extend range each wave. Aim for upward dog by the last few."},3:{dur:"45s",how:"Hands hovering off floor — spinal extensors only. Active back extension."},4:{dur:"60s",how:"Full upward dog to downward dog flow."},5:{dur:"45s",how:"Maintenance. Keep it flowing, never held."}}},
      {id:"st-thread-needle",name:"Thread the Needle",totalSec:120,sideLabels:["right arm under","left arm under"],muscles:["Thoracic spine","Posterior shoulder","Chest"],phases:{1:{dur:"60s per side",how:"On all-fours, slide one arm under your body until shoulder and cheek rest on ground. Press opposite hand into floor. Hips level."},2:{dur:"45s per side",how:"Add a press of the extended arm into floor at deepest point."},3:{dur:"30s per side",how:"Use threading arm to actively drive deeper — engage rhomboids and serratus."},4:{dur:"45s",how:"Add small arm circles from the threaded position."},5:{dur:"30s per side",how:"Maintenance. Important for overhead pressing and gymnastics shoulder health."}}},
      {id:"st-lat-stretch",name:"Overhead Lat Stretch",totalSec:90,sideLabels:["right arm","left arm"],muscles:["Lats","Long head triceps","Overhead shoulder flexion"],isNew:true,phases:{1:{dur:"45s per side",how:"Raise one arm overhead, bend elbow so hand drops behind head. Push elbow back and slightly across with opposite hand. Lean away for lat emphasis. Ribs down."},2:{dur:"45s per side",how:"Add a deliberate side bend away from the stretch arm. Feel stretch from hip to armpit."},3:{dur:"30s per side",how:"Press hand into palm overhead — create resistance and hold actively."},4:{dur:"45s per side",how:"From a lunge, reach into the overhead lat stretch on the same side."},5:{dur:"30s per side",how:"Maintenance. Supports handstand range and lat flexibility."}}},
      {id:"st-cross-body",name:"Cross-Body Shoulder",totalSec:90,sideLabels:["right arm","left arm"],muscles:["Rear deltoid","Rhomboids","Mid-back"],phases:{1:{dur:"45s per side",how:"Arm across body at shoulder height. Hook opposite arm underneath, draw toward chest. Shoulder pressed down."},2:{dur:"45s per side",how:"Try different heights. Spend time at the tightest angle."},3:{dur:"30s per side",how:"Slightly resist the pull with the stretched arm. Eccentric hold."},4:{dur:"45s",how:"Combine with thoracic rotation."},5:{dur:"30s per side",how:"Maintenance. Important given your lateral raise and reverse fly volume."}}},
      {id:"st-ankle",name:"Knee-to-Wall Ankle",totalSec:90,sideLabels:["right ankle","left ankle"],muscles:["Ankle dorsiflexion","Achilles","Soleus"],isNew:true,isDynamic:true,phases:{1:{dur:"45s per side",how:"Stand facing wall, foot three inches away. Drive knee over little toe keeping heel flat. Touch wall, return, repeat slowly."},2:{dur:"45s per side",how:"Add a two-second hold at end range. Move foot further from wall as range improves."},3:{dur:"10 reps + 10s holds",how:"At end range, hold for ten seconds. Dorsiflexion strength at end range."},4:{dur:"10 reps per side",how:"Progress to a slight step or incline."},5:{dur:"10 reps per side",how:"Maintenance. Keep this alongside Phase 3 plyometrics."}}},
      {id:"st-wrist",name:"Wrist and Forearm",totalSec:90,sideLabels:["right — palm up","right — palm down","left — palm up","left — palm down"],muscles:["Wrist flexors","Wrist extensors","Forearms"],phases:{1:{dur:"90s total",how:"Arm at shoulder height. Palm up: pull fingers down. Palm down: press back of hand toward you. About 22 seconds per position."},2:{dur:"90s + holds",how:"Add ten-second holds in the most uncomfortable position."},3:{dur:"60s + holds",how:"Progress to wrist push-ups on knuckles, then finger pads."},4:{dur:"90s",how:"Full sequence: standard, knuckles, fingers, reverse, side-to-side, active circles."},5:{dur:"60s",how:"Maintenance. Supports handstand loading and wrist health."}}},
      {id:"st-neck",name:"Neck Release",totalSec:90,sideLabels:["right side","left side"],muscles:["Neck","Upper traps"],phases:{1:{dur:"45s per side",how:"Sit tall. Gently tilt ear toward shoulder. Very light hand assist — do not crank."},2:{dur:"30s per side",how:"Add slow circles through full cervical range. Find stiffest angles."},3:{dur:"20s per side",how:"No hand assistance. Hold tilted position using only neck muscles on opposite side."},4:{dur:"30s",how:"Combine tilt and gentle rotation simultaneously."},5:{dur:"20s per side",how:"Maintenance. Upper trap tension from desk use accumulates fast."}}},
    ];

    const SPHASE = {
      1:{name:"Foundation",color:"#32ade6",months:"Months 1-3",desc:"Static stretching, habit formation, and breath-assisted relaxation. Build automaticity before chasing depth."},
      2:{name:"PNF",color:"#bf5af2",months:"Months 4-6",desc:"Contract-relax and CRAC work. Each priority stretch gets repeated cycles."},
      3:{name:"Active Flexibility",color:"#ff9f0a",months:"Months 7-9",desc:"CARs, dynamic movement, active end-range control, and PAILs/RAILs to close the neurological gap."},
      4:{name:"Integration",color:"#ff375f",months:"Months 10-12",desc:"Integrated mobility: CARs, dynamic warm-up, focused PNF, loaded work, Jefferson curls, and goal-specific practice."},
      5:{name:"Maintenance",color:"#30d158",months:"Ongoing",desc:"Maintain what you built or keep progressing. The routine becomes self-directed."},
    };

    // Build name→id mapping and run migration
    buildNameIdMap([...FB_SECTIONS, ...Object.values(TENDON), { exercises: STRETCHES }]);
    // Also map stretches
    STRETCHES.forEach(s => { if (s.id) NAME_TO_ID[s.name] = s.id; });
    Object.values(TENDON).forEach(phase => {
      phase.sessions.forEach(sess => {
        sess.exercises.forEach(ex => { if (ex.id) NAME_TO_ID[ex.name] = ex.id; });
      });
    });
    migrateData();

    const getPhaseStretches = phase => STRETCHES;
    const getPhaseTotalSec = phase => STRETCHES.reduce((a,s)=>a+s.totalSec,0);
    const getStretchCue = (stretch, phase) => {
      const phases = stretch.phases || {};
      return phases[phase]?.how || phases[1]?.how || Object.values(phases).find(p=>p?.how)?.how || stretch.cue || "";
    };
    // Explicit per-exercise preference: ex.unilateral === true/false overrides auto-detection
    const applySidePref = (ex, detected) => {
      if (ex.unilateral === false) return {...ex, sideLabels: []};
      if (ex.unilateral === true) {
        if (detected.sideLabels && detected.sideLabels.length) return detected;
        return {...ex, sideLabels: ["right side","left side"]};
      }
      return detected;
    };
    const _tendonSidesAuto = ex => {
      if (ex.sideLabels && ex.sideLabels.length) return ex;
      const text = `${ex.name||""} ${ex.equip||""} ${ex.reps||""} ${ex.cue||""}`.toLowerCase();
      if (/wrist|forearm/.test(text)) return {...ex, sideLabels:["right arm","left arm"]};
      if (ex.single || /single|one.?leg|one.?arm|unilateral|each|lunge|calf|hip flexor|lateral bound/.test(text)) return {...ex, sideLabels:["right leg","left leg"]};
      return ex;
    };
    const withTendonSides = ex => applySidePref(ex, _tendonSidesAuto(ex));
    // Generic unilateral detection for ALL routines (workouts, splits) — not just tendons.
    const _sidesAuto = ex => {
      if (ex.sideLabels && ex.sideLabels.length) return ex;
      const text = `${ex.name||""} ${ex.equip||""} ${ex.reps||""} ${ex.cue||""}`.toLowerCase();
      if (ex.single || /single|one.?arm|one.?leg|unilateral|each side|each leg|each arm|\beach\b|lunge|split squat|pistol|step.?up|cable single/.test(text)) {
        if (/wrist|forearm|arm|curl|raise|row|press|rotation|fly|twist/.test(text) && !/\bleg\b|calf|squat|lunge|rdl|step/.test(text)) return {...ex, sideLabels:["right arm","left arm"]};
        return {...ex, sideLabels:["right side","left side"]};
      }
      return ex;
    };
    const withSides = ex => applySidePref(ex, _sidesAuto(ex));
    const exerciseHasSides = ex => !!(withSides(ex).sideLabels && withSides(ex).sideLabels.length);
    const tendonExHasSides = ex => !!(withTendonSides(ex).sideLabels && withTendonSides(ex).sideLabels.length);
    // Small edit-mode toggle: decide unilateral (L/R) vs bilateral for any exercise
    function SideToggle({ex,onChange,detector}) {
      const uni = !!(((detector||withSides)(ex)).sideLabels||[]).length;
      return (
        <button onClick={e=>{e.stopPropagation();onChange(!uni);}} title="Unilateral (L/R) or bilateral"
          style={{padding:"6px 9px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",flexShrink:0,
            border:`1.5px solid ${uni?"var(--accent)":"var(--card-border)"}`,
            color:uni?"var(--accent)":"var(--text-secondary)",
            background:uni?"var(--accent-muted)":"var(--input-bg)"}}>
          {uni?"L/R":"Both"}
        </button>
      );
    }

    // ── Exercise Library (Hevy/Tracked-style database) ─────────────────────────
    // User-created exercises live here and show up in the picker under "★ Custom".
    const getCustomExercises = () => store.get("custom_exercises", []);
    const addCustomExercise = ex => {
      const list = getCustomExercises();
      // de-dupe by lowercased name
      if (list.some(e => e.name.toLowerCase() === ex.name.toLowerCase())) return list;
      const updated = [...list, ex];
      store.set("custom_exercises", updated);
      return updated;
    };
    const EXERCISE_DB = [
      {group:"Chest",items:[
        ["Bench Press","Barbell","Shoulder blades pinned, feet planted, bar to mid-chest, press up and slightly back"],
        ["Incline Bench Press","Barbell","30-45° bench, bar to upper chest, elbows ~45° from torso"],
        ["Dumbbell Bench Press","Dumbbell","Deep stretch at the bottom, press up and slightly in"],
        ["Incline Dumbbell Press","Dumbbell","Upper-chest focus — don't let the dumbbells drift over your face"],
        ["Chest Press","Machine","Handles level with mid-chest, squeeze at lockout without slamming"],
        ["Chest Fly","Machine","Slight elbow bend held constant, hug-a-tree arc, stretch under control"],
        ["Cable Crossover","Cable","Step forward split stance, sweep down and in, squeeze 1s"],
        ["Push Up","Bodyweight","Rigid plank, hands under shoulders, chest to floor"],
        ["Dips","Bodyweight","Lean forward for chest, elbows track back, shoulder-depth only"]]},
      {group:"Back",items:[
        ["Deadlift","Barbell","Bar over mid-foot, brace hard, push the floor away, hips and chest rise together"],
        ["Pull Up","Bodyweight","Dead hang start, drive elbows to ribs, chest to bar"],
        ["Chin Up","Bodyweight","Underhand grip, lead with the chest, control the descent"],
        ["Lat Pulldown","Cable","Slight lean back, pull to upper chest, elbows down and in"],
        ["Seated Cable Row","Cable","Chest tall, pull to belly button, squeeze shoulder blades"],
        ["Bent Over Row","Barbell","Hinge ~45°, flat back, row to lower ribs"],
        ["T-Bar Row","Machine","Chest on pad or hinged, drive elbows back, no jerking"],
        ["One Arm Dumbbell Row","Dumbbell","Square hips, row to hip pocket, full stretch at the bottom"],
        ["Face Pull","Cable","Rope at face height, pull apart to ears, thumbs back"],
        ["Straight Arm Pulldown","Cable","Arms long, sweep bar to thighs using lats only"],
        ["Back Extension","Bodyweight","Hinge at hips, squeeze glutes at the top, don't hyperextend"]]},
      {group:"Shoulders",items:[
        ["Overhead Press","Barbell","Glutes tight, bar path close to face, head through at lockout"],
        ["Shoulder Press","Machine","Back flat on pad, press without shrugging"],
        ["Arnold Press","Dumbbell","Rotate palms out as you press, full range"],
        ["Lateral Raise","Dumbbell","Lead with elbows, pour-the-jug tilt, stop at shoulder height"],
        ["One Arm Lateral Raise","Cable Single","Cable behind body, constant tension, strict tempo"],
        ["Front Raise","Dumbbell","Raise to eye level, no swing, control down"],
        ["Rear Delt Fly","Machine","Arms slightly bent, sweep back, squeeze rear delts not traps"],
        ["Upright Row","Barbell","Wide grip, elbows lead, bar to lower chest"],
        ["Shrug","Dumbbell","Straight up to ears, 1s hold at the top, no rolling"]]},
      {group:"Arms",items:[
        ["Bicep Curl","Dumbbell","Elbows pinned to sides, full stretch at bottom, no swing"],
        ["Hammer Curl","Dumbbell","Neutral grip, curls brachialis — keep wrists locked"],
        ["Preacher Curl","Machine","Armpits on pad, stretch fully at the bottom, no bounce"],
        ["Cable Curl","Cable","Constant tension, step back slightly, squeeze hard at the top"],
        ["Concentration Curl","Dumbbell","Elbow braced on inner thigh, slow negative"],
        ["Tricep Pushdown","Cable","Elbows glued to sides, full lockout, control up"],
        ["Overhead Tricep Extension","Cable","Elbows tucked by ears, deep stretch behind the head"],
        ["Skull Crusher","Barbell","Lower to forehead/behind head, elbows still, press to lockout"],
        ["Close Grip Bench Press","Barbell","Hands shoulder-width, elbows tucked, bar to lower chest"],
        ["Wrist Curl","Dumbbell","Forearm supported, full roll down to fingers, curl up"],
        ["Reverse Wrist Curl","Dumbbell","Palms down, lift the back of the hand, light weight strict form"]]},
      {group:"Legs",items:[
        ["Squat","Barbell","Brace, sit between the hips, knees track over toes, drive up"],
        ["Front Squat","Barbell","Elbows high, upright torso, full depth"],
        ["Hack Squat","Machine","Back flat on pad, feet mid-platform, deep controlled reps"],
        ["Leg Press","Machine","Don't lock knees hard, lower until hips begin to tuck"],
        ["Bulgarian Split Squat","Dumbbell","Rear foot elevated, drop straight down, front heel drives"],
        ["Walking Lunge","Dumbbell","Long stride, knee kisses floor, push through front heel"],
        ["Romanian Deadlift","Barbell","Soft knees, push hips back, bar slides down thighs, hamstring stretch"],
        ["Leg Extension","Machine","Pause 1s at the top, control the negative"],
        ["Seated Leg Curl","Machine","Hips pinned, full squeeze, slow eccentric"],
        ["Lying Leg Curl","Machine","Hips down on the pad, curl to glutes, 3s negative"],
        ["Hip Thrust","Barbell","Shoulders on bench, chin tucked, squeeze glutes to full lockout"],
        ["Standing Calf Raise","Machine","Full stretch at the bottom, pause, drive to tiptoe"],
        ["Seated Calf Raise","Machine","Soleus focus — slow, deep stretch each rep"],
        ["Calf Press","Machine","On leg press — full range, no bouncing"],
        ["Hip Abduction","Machine","Tall posture, push out with control, pause at the widest point"],
        ["Hip Adduction","Machine","Squeeze in smoothly, resist the return"],
        ["Step Up","Dumbbell","Whole foot on box, drive through heel, no push-off from back leg"],
        ["Single Leg RDL","Dumbbell","Hips square, hinge until hamstring stretch, slow return"]]},
      {group:"Core",items:[
        ["Plank","Bodyweight","Glutes and abs squeezed, straight line ear to ankle"],
        ["Side Plank","Bodyweight","Stacked feet, hips high, straight line"],
        ["Crunch","Bodyweight","Ribs to hips, exhale at the top, no neck pulling"],
        ["Cable Crunch","Cable","Kneel, crunch ribs toward pelvis, hips stay still"],
        ["Ab Crunch","Machine","Controlled flexion, full stretch at the top of each rep"],
        ["Hanging Leg Raise","Bodyweight","Posterior tilt first, raise legs without swinging"],
        ["Russian Twist","Bodyweight","Lean back 45°, rotate from the torso not the arms"],
        ["Ab Wheel Rollout","Bodyweight","Hollow body, roll out only as far as you can control"],
        ["Dead Bug","Bodyweight","Lower back glued to floor, opposite arm/leg, slow"],
        ["Pallof Press","Cable","Press out and resist rotation, breathe steadily"]]},
      {group:"Power",items:[
        ["Power Clean","Barbell","Explosive triple extension, fast elbows, catch in quarter squat"],
        ["Push Press","Barbell","Shallow dip, violent leg drive, punch overhead"],
        ["Kettlebell Swing","Kettlebell","Hip hinge snap, bell floats to chest, glutes finish"],
        ["Box Jump","Bodyweight","Full hip extension in the air, land soft and quiet"],
        ["Broad Jump","Bodyweight","Big arm swing, explode forward, stick the landing"],
        ["Pogo Jumps","Bodyweight","Stiff ankles, bounce off the ground fast, minimal knee bend"],
        ["Ankle Hops","Bodyweight","Small fast hops, calves and ankles do the work"],
        ["Jump Rope","Bodyweight","Wrists spin the rope, stay tall, small bounces"]]},
    ];

    // Tendon-specific library (isometrics, HSR, reactive/plyo, sprint). Used by tendon splits.
    const TENDON_DB = [
      {group:"Achilles / Calf",items:[
        {name:"Single-Leg Calf Raise Iso (Straight Knee)",equip:"Single leg + load",sets:4,hold:"35s",weight:"+40kg",rest:"60s",single:true,cue:"Straight knee biases the gastrocnemius. Hold still under load. Primary Achilles stiffness driver \u2014 progress by load."},
        {name:"Single-Leg Soleus Iso (Bent Knee)",equip:"Single leg + load",sets:3,hold:"30s",weight:"+30kg",rest:"60s",single:true,cue:"Knee bent ~20-30 deg shifts load to the soleus. Loads the deeper Achilles the straight-knee hold misses."},
        {name:"Calf Hold at Bottom Stretch",equip:"Single leg + load",sets:2,hold:"30s",weight:"+20kg",rest:"60s",single:true,cue:"Deep dorsiflexed stretch position, hold under load. Builds tendon compliance at length."},
        {name:"Heavy-Slow Calf Raise (Standing)",equip:"Machine/DB",sets:4,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",cue:"Gastrocnemius HSR. 3s down to stretch, 1s pause, 3s up at a true 6-8RM."},
        {name:"Heavy-Slow Calf Raise (Seated / Soleus)",equip:"Machine",sets:4,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",cue:"Bent knee = soleus HSR. The non-redundant second calf movement if you want one."},
        {name:"Tibialis Raise",equip:"Bodyweight/band",sets:3,reps:"15-20",rest:"60s",cue:"Heels down, lift the toes against resistance. Balances the ankle and protects the shin."},
      ]},
      {group:"Patellar / Quad",items:[
        {name:"Spanish Squat Iso",equip:"Band + plate",sets:4,hold:"40s",weight:"+20kg",rest:"60s",cue:"Band behind the knees, sit back against it, hold at ~90 deg. Patellar stiffness driver."},
        {name:"Split Squat Iso",equip:"Load",sets:3,hold:"30s",weight:"+15kg",rest:"60s",single:true,cue:"Hold the bottom of a split squat. Loads the patellar tendon at a second joint angle."},
        {name:"Wall Sit Iso",equip:"Load",sets:3,hold:"45s",weight:"+20kg",rest:"60s",cue:"Back flat on wall, thighs parallel, plate on the lap. Keep it loaded, not bodyweight."},
        {name:"Leg Extension HSR",equip:"Machine",sets:3,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",cue:"Patellar HSR. 3s down, 1s pause, 3s up at a true 6-8RM."},
        {name:"Slow Heavy Squat",equip:"Barbell/Machine",sets:3,reps:"6-8",tempo:"3-1-3",weight:"6-8RM",rest:"2 min",cue:"Controlled tempo squat for patellar and quad tendon load."},
        {name:"Single-Leg Decline Squat",equip:"Decline board",sets:3,reps:"8-10",tempo:"3-1-3",rest:"90s",single:true,cue:"Heel raised on a decline, slow descent. The classic patellar tendon loader."},
      ]},
      {group:"Hamstring",items:[
        {name:"Nordic Curl",equip:"Bodyweight",sets:4,reps:"4-6",tempo:"5s lower",rest:"90s",cue:"Slow controlled lower, fight gravity the whole way. Hamstring tendon eccentric strength."},
        {name:"Single-Leg RDL",equip:"DB/Barbell",sets:3,reps:"6-8",tempo:"3-1-3",rest:"90s",single:true,cue:"Hips square, hinge to a deep hamstring stretch, control the return."},
        {name:"Slider / Razor Curl",equip:"Bodyweight",sets:3,reps:"8-10",rest:"75s",cue:"Hips up, curl the heels in under control. Hamstring at short length."},
        {name:"Hamstring Bridge Iso Hold",equip:"Bodyweight",sets:3,hold:"30s",rest:"60s",single:true,cue:"Single-leg bridge, heel dug in, hold. Isometric hamstring tendon load."},
      ]},
      {group:"Wrist / Forearm",items:[
        {name:"Wrist Iso Holds (neutral / flex / ext)",equip:"Light band",sets:2,hold:"15s",rest:"45s",cue:"Hold each of the three positions. Light band, builds tolerance for handstand loading."},
        {name:"Slow Wrist Curl",equip:"DB/band",sets:3,reps:"8",tempo:"3-1-3",weight:"8-10kg",rest:"60s",cue:"Forearm supported, wrist only, slow and full range."},
        {name:"Slow Reverse Wrist Curl",equip:"DB/band",sets:3,reps:"8",tempo:"3-1-3",weight:"5-6kg",rest:"60s",cue:"Overhand, lift the back of the hand, slow eccentric."},
      ]},
      {group:"Reactive / Plyo",items:[
        {name:"Depth Jumps",equip:"Box ~30cm",sets:4,reps:"4",rest:"2 min",cue:"Step off, land, instantly rebound up. Minimal ground contact. Progress box height, never reps."},
        {name:"Broad Jumps",equip:"Bodyweight",sets:4,reps:"3",rest:"90s",cue:"Maximal horizontal distance, big arm drive, land soft."},
        {name:"Snap Downs",equip:"Bodyweight",sets:3,reps:"5",rest:"60s",cue:"Fast drop into an athletic stick. Absorb and freeze \u2014 teaches landing mechanics."},
        {name:"Stick Landings",equip:"Box ~30cm",sets:3,reps:"5",rest:"60s",cue:"Drop from a box, land, absorb, freeze 3s. Build the landing before the rebound."},
        {name:"Pogo Jumps",equip:"Bodyweight",sets:3,reps:"15",rest:"60s",cue:"Stiff ankles, fast bounces off the floor, minimal knee bend."},
        {name:"Ankle Hops",equip:"Bodyweight",sets:3,reps:"20",rest:"60s",cue:"Small fast hops, calves and ankles do the work."},
        {name:"Single-Leg Line Hops",equip:"Bodyweight",sets:3,reps:"10 / direction",rest:"60s",single:true,cue:"Fast hops over a line, stiff ankle. Think hot floor."},
        {name:"Lateral / Skater Bounds",equip:"Bodyweight",sets:3,reps:"8 (4/side)",rest:"75s",cue:"Explosive push off one leg, land and stick on the other. Lateral power for combat."},
        {name:"Single-Leg Bounds",equip:"Bodyweight",sets:3,reps:"6 / leg",rest:"90s",single:true,cue:"Max distance per bound, controlled landing."},
        {name:"Alternate-Leg Bounding",equip:"Bodyweight",sets:2,reps:"20m",rest:"2 min",cue:"Explosive bounding over 20m, alternating legs."},
        {name:"Box Jumps",equip:"Box",sets:4,reps:"5",rest:"90s",cue:"Full hip extension in the air, land soft and quiet."},
      ]},
      {group:"Sprint / Speed",items:[
        {name:"Accelerations (20m)",equip:"Sprint",sets:6,reps:"20m",weight:"~95%",rest:"2 min",cue:"~95% over 20m, walk back to recover. Set ends the moment speed drops."},
        {name:"Flying Sprints",equip:"Sprint",sets:4,reps:"20m",weight:"max",rest:"3 min",cue:"15m run-in then 20m at max velocity. Quality, not conditioning."},
        {name:"Resisted / Hill Sprints",equip:"Sled/hill",sets:5,reps:"20m",rest:"3 min",cue:"Light sled (~10-15% bodyweight) or a hill. Drives acceleration power."},
        {name:"Build-Up Runs",equip:"Sprint",sets:3,reps:"30m",rest:"90s",cue:"Accelerate 60 to 95% across the run, then ease off. Warm-up ramp."},
      ]},
    ];

    // Stretch / mobility library. Used by stretching splits.
    const STRETCH_DB = [
      {group:"Hips & Glutes",items:[
        {name:"World's Greatest Stretch",equip:"Stretch",totalSec:120,sideLabels:["right side","left side"],muscles:["Hip flexors","T-spine"],cue:"Deep lunge, hand inside the front foot, rotate the top arm to the ceiling. Drive the rear hip down each exhale."},
        {name:"Low Lunge \u2014 Quad / Hip Flexor",equip:"Stretch",totalSec:120,sideLabels:["right side","left side"],muscles:["Quads","Hip flexors"],cue:"Back knee down, grab the rear ankle to the glute, hips square. Front of the rear thigh."},
        {name:"Pigeon Pose",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Glutes","Piriformis"],cue:"Front shin across, hips square, fold forward over the front leg."},
        {name:"Figure-4 / 90-90",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Glutes","Hip rotators"],cue:"Cross ankle over thigh and draw in, or sit 90-90 and lean over the front shin."},
        {name:"Couch Stretch",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Hip flexors","Quads"],cue:"Rear shin up a wall, square the hips, tuck the pelvis. Strong hip-flexor stretch."},
        {name:"Butterfly Stretch",equip:"Stretch",totalSec:90,sideLabels:[],muscles:["Adductors","Groin"],cue:"Soles together, sit tall, gently press the knees down with the elbows."},
        {name:"Frog Stretch",equip:"Stretch",totalSec:90,sideLabels:[],muscles:["Adductors","Groin"],cue:"Knees wide on the floor, shins out, rock the hips back slowly."},
        {name:"Straddle / Pancake",equip:"Stretch",totalSec:120,sideLabels:[],muscles:["Adductors","Hamstrings"],cue:"Legs wide, hinge from the hips with a long spine, walk the hands forward."},
      ]},
      {group:"Hamstrings & Posterior",items:[
        {name:"Seated Forward Fold",equip:"Stretch",totalSec:90,sideLabels:[],muscles:["Hamstrings","Low back"],cue:"Legs straight, hinge from the hips not the mid-back. Long spine first, depth second."},
        {name:"Standing Hamstring Stretch",equip:"Stretch",totalSec:60,sideLabels:["right side","left side"],muscles:["Hamstrings"],cue:"Heel forward, hinge over the straight leg, keep the back flat."},
        {name:"Downward Dog",equip:"Stretch",totalSec:60,sideLabels:[],muscles:["Hamstrings","Calves","Shoulders"],cue:"Hips up and back, heels reaching for the floor, long spine."},
        {name:"Jefferson Curl (loaded)",equip:"Light load",totalSec:60,sideLabels:[],muscles:["Posterior chain"],cue:"Slow segmental roll-down with a light weight. Advanced \u2014 load the spine and hams gently."},
      ]},
      {group:"Back & Spine",items:[
        {name:"Cat-Cow",equip:"Stretch",totalSec:60,sideLabels:[],muscles:["Spine"],cue:"On all-fours, arch down then round up, slow rhythmic cycles. Keep moving."},
        {name:"Cobra / Upward Dog Waves",equip:"Stretch",totalSec:60,sideLabels:[],muscles:["Spine","Abs"],cue:"Face down, press slowly into extension, hold, lower, repeat. Never crank."},
        {name:"Child's Pose",equip:"Stretch",totalSec:60,sideLabels:[],muscles:["Lats","Low back"],cue:"Hips to heels, arms long, breathe into the back."},
        {name:"Seated Spinal Twist",equip:"Stretch",totalSec:60,sideLabels:["right side","left side"],muscles:["Spine","Glutes"],cue:"Sit tall, rotate from the mid-back, use the arm as a lever not a crank."},
        {name:"Thread the Needle",equip:"Stretch",totalSec:120,sideLabels:["right arm under","left arm under"],muscles:["T-spine","Posterior shoulder"],cue:"On all-fours, slide one arm under, shoulder and cheek to the ground, hips level."},
      ]},
      {group:"Shoulders & Upper",items:[
        {name:"Overhead Lat Stretch",equip:"Stretch",totalSec:90,sideLabels:["right arm","left arm"],muscles:["Lats"],cue:"Hand behind the head, push the elbow back and across, lean away. Ribs down."},
        {name:"Cross-Body Shoulder",equip:"Stretch",totalSec:90,sideLabels:["right arm","left arm"],muscles:["Rear delt","Rhomboids"],cue:"Arm across the body, draw it in with the opposite arm, shoulder pressed down."},
        {name:"Band Shoulder Dislocates",equip:"Band",totalSec:60,sideLabels:[],muscles:["Shoulders"],cue:"Wide grip on a band, pass it overhead and behind, slow. Opens the shoulders."},
        {name:"Doorway Pec Stretch",equip:"Stretch",totalSec:60,sideLabels:["right side","left side"],muscles:["Chest"],cue:"Forearm on the frame, step through, rotate away from the arm."},
        {name:"Neck Release",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Neck","Upper traps"],cue:"Tilt ear to shoulder, very light hand assist, never crank."},
      ]},
      {group:"Ankles & Wrists",items:[
        {name:"Knee-to-Wall Ankle",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Ankle dorsiflexion","Achilles"],cue:"Foot a few inches from the wall, drive the knee over the toes, heel flat."},
        {name:"Calf / Soleus Wall Stretch",equip:"Stretch",totalSec:60,sideLabels:["right side","left side"],muscles:["Calves","Achilles"],cue:"Straight back leg for gastroc, bent for soleus. Heel down."},
        {name:"Wrist & Forearm",equip:"Stretch",totalSec:90,sideLabels:["right side","left side"],muscles:["Wrist flexors","Extensors"],cue:"Arm out, palm up then palm down, gently pull the fingers back each way."},
        {name:"Wrist Extension on Floor",equip:"Stretch",totalSec:60,sideLabels:[],muscles:["Wrist flexors"],cue:"On all-fours, palms down fingers back, rock gently. Handstand prep."},
      ]},
    ];

    // Map any exercise name to a body part (library lookup first, then keywords)
    function Confetti() {
      const pieces = useMemo(()=>Array.from({length:80},(_,i)=>({
        id:i, left:Math.random()*100, delay:Math.random()*0.5, dur:2.2+Math.random()*1.5,
        rot:Math.random()*360, size:6+Math.random()*7,
        color:["var(--accent)","var(--pr-gold)","#fff","var(--success)"][i%4]
      })),[]);
      return (
        <div style={{position:"fixed",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:50}}>
          {pieces.map(p=>(
            <span key={p.id} style={{position:"absolute",top:"-20px",left:`${p.left}%`,width:`${p.size}px`,height:`${p.size*0.6}px`,
              background:p.color,borderRadius:"1px",opacity:0.9,
              animation:`confettiFall ${p.dur}s linear ${p.delay}s forwards`,transform:`rotate(${p.rot}deg)`}}/>
          ))}
        </div>
      );
    }

    const MUSCLE_LOOKUP = (() => { const m={}; EXERCISE_DB.forEach(g=>g.items.forEach(([n])=>{m[n.toLowerCase()]=g.group;})); return m; })();
    const muscleGroupOf = name => {
      const n = (name||"").toLowerCase();
      if (MUSCLE_LOOKUP[n]) return MUSCLE_LOOKUP[n];
      if (/bench|chest|fly|crossover|push.?up|dip\b|pec/.test(n)) return "Chest";
      if (/row|pulldown|pull.?up|chin.?up|deadlift|lat\b|face pull|back ext/.test(n)) return "Back";
      if (/shoulder|lateral raise|front raise|rear delt|overhead press|shrug|upright|delt/.test(n)) return "Shoulders";
      if (/curl|tricep|extension|skull|pushdown|wrist|forearm|bicep/.test(n)) return "Arms";
      if (/squat|leg|lunge|calf|hip|glute|rdl|thigh|hamstring|quad|adduct|abduct|step.?up|thrust/.test(n)) return "Legs";
      if (/ab\b|abs|crunch|plank|core|twist|dead bug|pallof|hollow/.test(n)) return "Core";
      if (/jump|hop|clean|snatch|swing|pogo|sprint|bound/.test(n)) return "Power";
      return "Other";
    };
    // Searchable picker: body-part tabs across the top (Tracked-style), cue under each name
    function ExercisePickList({sections,picked,setPicked,query,setQuery,single,db,allowCreate=true}) {
      const LIB = db || EXERCISE_DB;
      const [tab,setTab]=useState("All");
      const [custom,setCustom]=useState(()=>getCustomExercises());
      const [creating,setCreating]=useState(false);
      const [newName,setNewName]=useState("");
      const [newEquip,setNewEquip]=useState("Machine");
      const [newGroup,setNewGroup]=useState("Legs");
      const [newCue,setNewCue]=useState("");
      const hasYours=!!(sections&&sections.length);
      const hasCustom=custom.length>0 && !db;
      const tabs=["All",...(hasYours?["★ Yours"]:[]),...(hasCustom?["★ Custom"]:[]),...LIB.map(g=>g.group)];
      const yourGroups=hasYours?sections.map(s=>({group:`★ ${s.section}`,yours:true,items:s.exercises.map(e=>({key:`y-${e.id||e.name}`,name:e.name,equip:e.equip||"",cue:e.cue||"",src:e}))})):[];
      const customGroup=hasCustom?[{group:"★ Custom",custom:true,items:custom.map(e=>({key:`c-${e.name}`,name:e.name,equip:e.equip||"",cue:e.cue||"",muscle:e.muscle||"Other"}))}]:[];
      const libGroups=LIB.map(g=>({group:g.group,items:g.items.map(it=>{const o=Array.isArray(it)?{name:it[0],equip:it[1],cue:it[2]||""}:it;return {key:`l-${g.group}-${o.name}`,name:o.name,equip:o.equip||"",cue:o.cue||"",muscle:g.group,meta:o};})}));
      const q=(query||"").trim().toLowerCase();
      let groups=[...yourGroups,...customGroup,...libGroups];
      if(!q){
        if(tab==="★ Yours")groups=yourGroups;
        else if(tab==="★ Custom")groups=customGroup;
        else if(tab!=="All")groups=libGroups.filter(g=>g.group===tab);
      }
      groups=groups.map(g=>({...g,items:g.items.filter(it=>!q||it.name.toLowerCase().includes(q)||(it.equip||"").toLowerCase().includes(q))})).filter(g=>g.items.length);
      const toggle=it=>setPicked(p=>{
        if(single)return p[it.key]?{}:{[it.key]:it};
        const u={...p};if(u[it.key])delete u[it.key];else u[it.key]=it;return u;
      });
      return (
        <div>
          <input className="field" placeholder="Search all exercises…" value={query} onChange={e=>setQuery(e.target.value)} style={{marginBottom:"8px"}}/>
          <div style={{display:"flex",gap:"6px",overflowX:"auto",paddingBottom:"8px",WebkitOverflowScrolling:"touch"}}>
            {tabs.map(t=>(
              <button key={t} onClick={()=>setTab(t)} style={{flexShrink:0,padding:"7px 12px",borderRadius:"999px",fontSize:"12px",fontWeight:"800",whiteSpace:"nowrap",
                border:`1.5px solid ${tab===t&&!q?"var(--accent)":"var(--card-border)"}`,
                background:tab===t&&!q?"var(--accent-muted)":"transparent",
                color:tab===t&&!q?"var(--accent)":"var(--text-secondary)"}}>{t}</button>
            ))}
          </div>
          {allowCreate && (!creating ? (
            <button className="button-secondary" style={{marginBottom:"8px",padding:"9px",fontSize:"13px"}} onClick={()=>setCreating(true)}>+ Create new exercise</button>
          ) : (
            <div className="card" style={{marginBottom:"8px",padding:"12px"}}>
              <p className="font-bold" style={{fontSize:"14px",marginBottom:"8px"}}>New exercise</p>
              <input className="field" placeholder="Name (e.g. Cable Pullover)" value={newName} onChange={e=>setNewName(e.target.value)}/>
              <input className="field" placeholder="Equipment (e.g. Cable, Machine)" value={newEquip} onChange={e=>setNewEquip(e.target.value)}/>
              <select className="field" value={newGroup} onChange={e=>setNewGroup(e.target.value)}>
                {["Chest","Back","Shoulders","Arms","Legs","Core","Power","Other"].map(g=><option key={g} value={g}>{g}</option>)}
              </select>
              <input className="field" placeholder="Cue (optional)" value={newCue} onChange={e=>setNewCue(e.target.value)} style={{marginBottom:"10px"}}/>
              <div style={{display:"flex",gap:"8px"}}>
                <button className="button-primary" style={{padding:"10px",fontSize:"14px"}} disabled={!newName.trim()} onClick={()=>{
                  const ex={name:newName.trim(),equip:newEquip.trim()||"Other",muscle:newGroup,cue:newCue.trim()};
                  const updated=addCustomExercise(ex);
                  setCustom(updated);
                  setNewName("");setNewEquip("Machine");setNewGroup("Legs");setNewCue("");
                  setCreating(false);setTab("★ Custom");
                }}>Save to library</button>
                <button className="button-secondary" style={{padding:"10px",fontSize:"14px"}} onClick={()=>{setCreating(false);setNewName("");setNewCue("");}}>Cancel</button>
              </div>
            </div>
          ))}
          <div style={{maxHeight:"36vh",overflowY:"auto",border:"1px solid var(--card-border)",borderRadius:"12px",padding:"6px 10px"}}>
            {groups.length===0&&<p className="text-small" style={{padding:"14px",textAlign:"center"}}>No matches</p>}
            {groups.map(g=>(
              <div key={g.group} style={{marginBottom:"6px"}}>
                <p className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"800",letterSpacing:"0.5px",margin:"8px 0 4px"}}>{g.group}</p>
                {g.items.map(it=>(
                  <label key={it.key} style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"8px 2px",cursor:"pointer",borderBottom:"0.5px solid var(--card-border)"}}>
                    <input type={single?"radio":"checkbox"} checked={!!picked[it.key]} onChange={()=>toggle(it)} style={{width:"17px",height:"17px",accentColor:"var(--accent)",flexShrink:0,marginTop:"2px"}}/>
                    <span style={{flex:1}}>
                      <span style={{display:"flex",justifyContent:"space-between",gap:"8px"}}>
                        <span style={{fontSize:"14px",fontWeight:"700"}}>{it.name}</span>
                        <span className="text-small" style={{fontSize:"11px",flexShrink:0}}>{it.equip}</span>
                      </span>
                      {it.cue&&<span className="text-small" style={{display:"block",fontSize:"11px",marginTop:"2px",lineHeight:"1.35"}}>{it.cue}</span>}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
    }
    const pickedToExercises = (picked, kind) => Object.values(picked).map(it => {
      if (it.src) return {...it.src, id: uid()};
      const m = it.meta || {};
      if (kind === 'stretch') return {id:uid(),name:it.name,equip:it.equip||"Stretch",sets:1,reps:"",hold:`${m.totalSec||45}s`,totalSec:m.totalSec||45,rest:"15s",weight:"",sideLabels:m.sideLabels||[],muscles:m.muscles||[],cue:m.cue||it.cue||""};
      if (kind === 'tendon') return {id:uid(),name:it.name,equip:it.equip||"Tendon",sets:m.sets||3,reps:m.reps||"",hold:m.hold||"30s",tempo:m.tempo||"",rest:m.rest||"90s",weight:m.weight||"",single:!!m.single,cue:m.cue||it.cue||""};
      return {id:uid(),name:it.name,equip:it.equip,sets:m.sets||1,reps:m.reps||"5-8",hold:"",rest:m.rest||"90s",weight:"",cue:it.cue||""};
    });

    // Tracked-style plate calculator + warm-up ramp
    function PlateCalcModal({initialWeight,onClose}) {
      const [target,setTarget]=useState(String(parseWeight(initialWeight)||""));
      const [bar,setBar]=useState(()=>String(store.get("plate_bar_kg",20)));
      const t=parseFloat(target)||0, b=parseFloat(bar)||20;
      const perSide=Math.max(0,(t-b)/2);
      const plates=[];let r=perSide;
      [25,20,15,10,5,2.5,1.25].forEach(p=>{while(r>=p-1e-9){plates.push(p);r-=p;}});
      const leftover=Math.round(r*100)/100;
      const warm=[[40,10],[60,6],[80,3]].map(([pc,reps])=>({pc,reps,w:Math.max(b,Math.round(t*pc/100/2.5)*2.5)}));
      return (
        <div className="modal-bg" style={{zIndex:200}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
          <div className="modal-body">
            <div className="drag-bar"/>
            <h3 className="font-bold" style={{fontSize:"19px",marginBottom:"12px"}}>Plate Calculator</h3>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
              <div><label className="field-label">Target (kg)</label><input className="field" type="number" inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)}/></div>
              <div><label className="field-label">Bar (kg)</label>
                <select className="field" value={bar} onChange={e=>{setBar(e.target.value);store.set("plate_bar_kg",parseFloat(e.target.value)||20);}}>
                  {["20","15","10","7.5"].map(o=><option key={o} value={o}>{o} kg</option>)}
                </select>
              </div>
            </div>
            {t>0&&(
              <div className="card" style={{marginBottom:"12px"}}>
                <p className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"800",marginBottom:"6px"}}>Per side</p>
                {t<b?<p className="text-small">Target is below the bar weight</p>:plates.length===0?<p className="text-small">Empty bar</p>:(
                  <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center"}}>
                    {plates.map((p,i)=><span key={i} className="badge" style={{fontSize:"13px",fontWeight:"800",padding:"6px 10px"}}>{p}</span>)}
                    {leftover>0&&<span className="text-small">+{leftover}kg unmatched</span>}
                  </div>
                )}
              </div>
            )}
            {t>0&&(
              <div className="card" style={{marginBottom:"12px"}}>
                <p className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"800",marginBottom:"6px"}}>Warm-up ramp</p>
                {warm.map(w=>(
                  <div key={w.pc} style={{display:"flex",justifyContent:"space-between",padding:"4px 0"}}>
                    <span className="text-small">{w.pc}% × {w.reps} reps</span>
                    <span className="font-bold" style={{color:"var(--accent)"}}>{w.w} kg</span>
                  </div>
                ))}
              </div>
            )}
            <button className="button-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      );
    }

    // ── Icons ──────────────────────────────────────────────────────────────────
    const Icons = {
      Home:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>,
      Dumbbell:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10" width="15" height="4" rx="1"/><rect x="1" y="9" width="3.5" height="6" rx="1"/><rect x="19.5" y="9" width="3.5" height="6" rx="1"/></svg>,
      Tendon:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h8l-1 8 11-12h-8z"/></svg>,
      Stretch:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v6M9 21l3-8 3 8M6 13h12"/></svg>,
      Chart:()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
      Refresh:({size=20})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>,
      Play:({size=24})=><svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
      Pause:({size=24})=><svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>,
      Note:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      Trophy:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 22V2h4v20"/><rect x="6" y="2" width="12" height="7" rx="1"/></svg>,
      Swap:({size=16})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H4"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h16"/></svg>,
      Plate:({size=16})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/></svg>,
      Link:({size=12})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
      Bell:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
      Download:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
      Upload:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
      Library:({size=14})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
      Clock:({size=12})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      Minimize:({size=18})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
      Play:({size=16})=><svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>,
      Gear:({size=20})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
      Flame:({size=20})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3 2.5.5 5 2.5 5 6a4.5 4.5 0 1 1-9 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/><path d="M12 2c1 3 2.5 3.5 4 5 1.86 1.86 3 4.21 3 7a7 7 0 1 1-14 0c0-2 .5-3.5 1.5-5"/></svg>,
    };

    // ── Shared Small Components ───────────────────────────────────────────────
    function WeightChip({exKey,defaultWeight,color,weights,onSave}) {
      const [editing,setEditing]=useState(false);
      const ref=useRef(null);
      const stored=weights[exKey];
      const val=stored!==undefined?stored:(defaultWeight||"");
      const [draft,setDraft]=useState(val);
      const startEdit=e=>{e.stopPropagation();setDraft(String(val).replace(/[^\d.]/g,''));setEditing(true);setTimeout(()=>{if(ref.current){ref.current.focus();ref.current.select();}},50);};
      const commit=()=>{const d=draft.trim();onSave(exKey,d?`${d}kg`:"");setEditing(false);};
      if(editing) return <input ref={ref} inputMode="decimal" value={draft} onChange={e=>setDraft(decOnly(e.target.value))} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} onClick={e=>e.stopPropagation()} placeholder="kg" style={{background:"var(--accent-muted)",border:"1.5px solid var(--accent)",borderRadius:"8px",color:"var(--text)",fontSize:"13px",fontWeight:"700",padding:"6px 10px",width:"85px",textAlign:"center"}}/>;
      return <button onClick={startEdit} style={{background:val?"var(--accent-muted)":"var(--input-bg)",border:val?"1.5px solid var(--accent)":"1.5px solid var(--card-border)",borderRadius:"8px",color:val?"var(--accent)":"var(--text-secondary)",fontSize:"13px",fontWeight:"700",padding:"6px 12px"}}>{val||"Set Weight"}</button>;
    }

    function RepsChip({exKey,defaultReps,color,reps,onSave}) {
      const [editing,setEditing]=useState(false);
      const ref=useRef(null);
      const stored=reps[exKey];
      const val=stored!==undefined?stored:(defaultReps||"");
      const [draft,setDraft]=useState(val);
      const startEdit=e=>{e.stopPropagation();setDraft(val);setEditing(true);setTimeout(()=>{if(ref.current){ref.current.focus();ref.current.select();}},50);};
      const commit=()=>{onSave(exKey,draft.trim());setEditing(false);};
      if(editing) return <input ref={ref} inputMode="numeric" value={draft} onChange={e=>setDraft(numOnly(e.target.value))} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} onClick={e=>e.stopPropagation()} placeholder="e.g. 10" style={{background:"var(--accent-muted)",border:"1.5px solid var(--accent)",borderRadius:"8px",color:"var(--text)",fontSize:"13px",fontWeight:"700",padding:"6px 10px",width:"75px",textAlign:"center"}}/>;
      return <button onClick={startEdit} style={{background:val?"var(--accent-muted)":"var(--input-bg)",border:val?"1.5px solid var(--accent)":"1.5px solid var(--card-border)",borderRadius:"8px",color:val?"var(--accent)":"var(--text-secondary)",fontSize:"13px",fontWeight:"700",padding:"6px 12px"}}>{val||"Reps"}</button>;
    }

    function TapModal({isOpen,onClose,children}) {
      if(!isOpen) return null;
      return <div className="modal-bg" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-body"><div className="drag-bar"/>{children}</div></div>;
    }

    // Double-tap (or double-click) any text to edit it inline.
    // singleAction (optional) fires on a single tap, debounced so a double tap edits instead.
    const PALETTE = ['#ff453a','#ff9f0a','#ffd700','#30d158','#0a84ff','#bf5af2','#ff375f','#32ade6','#5e5ce6','#64d2ff'];
    function Editable({value,onSave,as='span',className,style,placeholder,multiline,singleAction,stop=true}) {
      const [editing,setEditing]=useState(false);
      const [draft,setDraft]=useState(value);
      const [pressing,setPressing]=useState(false);
      const lastTap=useRef(0);
      const singleTimer=useRef(null);
      const longPressTimer=useRef(null);
      const ref=useRef(null);
      const startPos=useRef(null);
      useEffect(()=>{ if(!editing) setDraft(value); },[value,editing]);
      const begin=()=>{ setDraft(value); setEditing(true); setTimeout(()=>{ if(ref.current){ ref.current.focus(); try{ref.current.select();}catch{} } },30); };
      const commit=()=>{ setEditing(false); const t=(draft==null?'':String(draft)); if(t!==(value==null?'':String(value))) onSave(t); };
      const cancelLongPress=()=>{ if(longPressTimer.current){ clearTimeout(longPressTimer.current); longPressTimer.current=null; } setPressing(false); };
      const handlePointerDown=(e)=>{
        startPos.current={x:e.clientX,y:e.clientY};
        setPressing(true);
        longPressTimer.current=setTimeout(()=>{
          longPressTimer.current=null; setPressing(false);
          try{navigator.vibrate?.(30);}catch{}
          if(singleTimer.current){clearTimeout(singleTimer.current);singleTimer.current=null;}
          lastTap.current=0;
          begin();
        },500);
      };
      const handlePointerMove=(e)=>{
        if(startPos.current&&longPressTimer.current){
          const dx=Math.abs(e.clientX-startPos.current.x), dy=Math.abs(e.clientY-startPos.current.y);
          if(dx>10||dy>10) cancelLongPress();
        }
      };
      const handlePointerUpOrLeave=()=>cancelLongPress();
      const handleClick=(e)=>{
        if(stop) e.stopPropagation();
        const now=Date.now();
        if(now-lastTap.current<350){
          lastTap.current=0;
          if(singleTimer.current){ clearTimeout(singleTimer.current); singleTimer.current=null; }
          begin();
        } else {
          lastTap.current=now;
          if(singleAction){
            if(singleTimer.current) clearTimeout(singleTimer.current);
            singleTimer.current=setTimeout(()=>{ singleTimer.current=null; singleAction(); },360);
          }
        }
      };
      if(editing){
        const common={ ref, value:draft==null?'':draft, onChange:e=>setDraft(e.target.value), onBlur:commit,
          onClick:e=>e.stopPropagation(),
          onKeyDown:e=>{ if(e.key==='Enter'&&!multiline){ e.preventDefault(); commit(); } if(e.key==='Escape'){ setEditing(false); } },
          className:'field', style:{marginBottom:0,...(style||{})} };
        return multiline ? <textarea {...common} rows={3} placeholder={placeholder}/> : <input {...common} placeholder={placeholder}/>;
      }
      const Tag=as;
      return <Tag className={className} style={{cursor:'text',transition:'transform 0.15s, opacity 0.15s',...(pressing?{transform:'scale(0.97)',opacity:0.7}:{}),...(style||{})}}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUpOrLeave}
        onPointerLeave={handlePointerUpOrLeave}
        onPointerCancel={handlePointerUpOrLeave}
        title="Long-press or double-tap to edit"
      >{(value!=null&&value!=='')?value:<span style={{opacity:0.4}}>{placeholder||'Long-press to edit'}</span>}</Tag>;
    }

    function ColorPalette({value,onPick}) {
      return (
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',margin:'12px 0 4px'}}>
          {PALETTE.map(c=>(
            <button key={c} onClick={()=>onPick(c)} title={c} style={{width:'30px',height:'30px',borderRadius:'50%',background:c,border:value===c?'3px solid var(--text)':'2px solid var(--card-border)',flexShrink:0}}/>
          ))}
        </div>
      );
    }

    function PreviousPerformanceBanner({exerciseId, exerciseName, compact}) {
      const last = getLastPerformance(exerciseId, exerciseName);
      const best = getBestPerformance(exerciseId, exerciseName);
      if (!last) return null;
      return (
        <div className="prev-perf">
          <span className="perf-tag">Last: {fmtWeight(last.weight)} × {last.reps || '—'}</span>
          {best?.bestWeight && parseWeight(best.bestWeight.weight) > 0 && (
            <span className="perf-tag best">Best: {fmtWeight(best.bestWeight.weight)} × {best.bestWeight.reps || '—'}</span>
          )}
          {!compact && best?.best1RM && calc1RM(best.best1RM.weight, best.best1RM.reps) > 0 && (
            <span className="perf-tag" style={{fontSize:"11px"}}>Est 1RM: {calc1RM(best.best1RM.weight, best.best1RM.reps)}kg</span>
          )}
        </div>
      );
    }

    function ExerciseNoteButton({exerciseId, notes, onSave}) {
      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState(notes[exerciseId] || '');
      const hasNote = !!(notes[exerciseId]);
      if (editing) {
        return (
          <TapModal isOpen onClose={() => setEditing(false)}>
            <h3 className="font-bold" style={{marginBottom:"12px"}}>Exercise Notes</h3>
            <textarea className="field" style={{height:"120px",resize:"vertical"}} value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. Use blue pad, bench setting 4..." autoFocus/>
            <div style={{display:"flex",gap:"10px"}}>
              <button className="button-primary" onClick={() => { onSave(exerciseId, draft.trim()); setEditing(false); }}>Save</button>
              {hasNote && <button className="button-secondary" style={{color:"var(--danger)",borderColor:"var(--danger)"}} onClick={() => { onSave(exerciseId, ''); setEditing(false); }}>Clear</button>}
            </div>
          </TapModal>
        );
      }
      return <button className={`note-icon ${hasNote ? 'has-note' : ''}`} onClick={e => { e.stopPropagation(); setDraft(notes[exerciseId] || ''); setEditing(true); }} title="Notes"><Icons.Note size={13}/></button>;
    }

    function ExerciseHistoryModal({exerciseId, exerciseName, onClose}) {
      const [histMode,setHistMode]=useState("weight");
      const history = useMemo(() => getExerciseHistory(exerciseId).length > 0 ? getExerciseHistory(exerciseId) : getExerciseHistory(exerciseName), [exerciseId, exerciseName]);
      const best = getBestPerformance(exerciseId, exerciseName);
      return (
        <TapModal isOpen onClose={onClose}>
          <h3 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>{exerciseName}</h3>
          <p className="text-small" style={{marginBottom:"16px"}}>Exercise History</p>
          {best?.bestWeight && parseWeight(best.bestWeight.weight) > 0 && (
            <div style={{display:"flex",gap:"8px",marginBottom:"16px",flexWrap:"wrap"}}>
              <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>Max Weight:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{fmtWeight(best.bestWeight.weight)}</span></div>
              {best.bestReps && <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>Max Reps:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{best.bestReps.reps}</span></div>}
              {best.best1RM && <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>Est 1RM:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{calc1RM(best.best1RM.weight, best.best1RM.reps)}kg</span></div>}
            </div>
          )}
          <div style={{display:"flex",gap:"4px",justifyContent:"flex-end",marginBottom:"4px"}}>
            {[["weight","Weight"],["1rm","Est 1RM"]].map(([m,lab])=>(
              <button key={m} onClick={()=>setHistMode(m)} style={{padding:"5px 10px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",
                border:`1.5px solid ${histMode===m?"var(--accent)":"var(--card-border)"}`,
                color:histMode===m?"var(--accent)":"var(--text-secondary)",
                background:histMode===m?"var(--accent-muted)":"transparent"}}>{lab}</button>
            ))}
          </div>
          <ProgressionChart data={history} selectedExercise={exerciseName} mode={histMode}/>
          <div style={{marginTop:"16px"}}>
            {history.length === 0 ? (
              <p className="text-small" style={{textAlign:"center",padding:"20px"}}>No history yet</p>
            ) : history.map((h, i) => (
              <div key={i} className="ex-history-entry">
                <span className="text-small">{h.date}</span>
                <span className="font-bold" style={{color:"var(--accent)"}}>
                  {h.weight && h.weight !== "0" ? fmtWeight(h.weight) : 'BW'} {h.reps ? `× ${h.reps}` : ''} {h.hold && h.hold !== "0" ? `· ${h.hold}` : ''} {h.setNumber ? `(Set ${h.setNumber})` : ''}
                </span>
              </div>
            ))}
          </div>
        </TapModal>
      );
    }

    function ProgressionChart({data,selectedExercise,mode}) {
      const canvasRef=useRef(null);
      useEffect(()=>{
        if(!canvasRef.current||!data||data.length<2) return;
        const canvas=canvasRef.current;
        const ctx=canvas.getContext('2d');
        if(!ctx) return;
        const rect=canvas.getBoundingClientRect();
        canvas.width=rect.width*2; canvas.height=rect.height*2; ctx.scale(2,2);
        const w=rect.width,h=rect.height,pad=35;
        const val=d=>mode==='1rm'?(calc1RM(d.weight,d.reps)||parseWeight(d.weight)):parseWeight(d.weight);
        const pts=data.map(d=>({date:new Date(d.date),weight:val(d),label:d.weight||"0"})).sort((a,b)=>a.date-b.date);
        const wts=pts.map(p=>p.weight),minW=Math.min(...wts)*0.9,maxW=Math.max(...wts)*1.1||10,rng=maxW-minW||10;
        ctx.clearRect(0,0,w,h);
        const isAR=document.documentElement.getAttribute('data-theme')==='anti-red';
        const sc=isAR?'#ffd700':'#bf5af2',gc=isAR?'rgba(255,215,0,0.15)':'rgba(255,255,255,0.08)',tc=isAR?'#ffd700':'#8e8e93';
        ctx.strokeStyle=gc; ctx.lineWidth=1; ctx.fillStyle=tc; ctx.font='10px sans-serif'; ctx.textAlign='right';
        for(let i=0;i<=3;i++){const y=pad+(h-pad*2)*(i/3),wv=maxW-rng*(i/3);ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-15,y);ctx.stroke();ctx.fillText(`${wv.toFixed(1)}kg`,pad-6,y+3);}
        const gx=i=>pad+(w-pad-20)*(i/(pts.length-1)),gy=v=>h-pad-(h-pad*2)*((v-minW)/rng);
        ctx.strokeStyle=sc; ctx.lineWidth=2.5; ctx.beginPath();
        pts.forEach((p,i)=>{const x=gx(i),y=gy(p.weight);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
        ctx.stroke();
        if(!isAR){ctx.fillStyle='rgba(191,90,242,0.1)';ctx.beginPath();ctx.moveTo(gx(0),h-pad);pts.forEach((p,i)=>ctx.lineTo(gx(i),gy(p.weight)));ctx.lineTo(gx(pts.length-1),h-pad);ctx.closePath();ctx.fill();}
        pts.forEach((p,i)=>{const x=gx(i),y=gy(p.weight);ctx.fillStyle=sc;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle=isAR?'#ffd700':'#fff';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillText(p.label,x,y-8);ctx.fillStyle=tc;ctx.font='8px sans-serif';ctx.fillText(`${p.date.getMonth()+1}/${p.date.getDate()}`,x,h-pad+14);});
      },[data,selectedExercise,mode]);
      if(!data||data.length<2) return <div className="chart-container" style={{display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-secondary)",fontSize:"14px"}}>Complete this exercise twice to start tracking progression</div>;
      return (<div style={{overflowX:"auto",minWidth: `${data.length * 50}px`}}><div className="chart-container"><canvas ref={canvasRef} className="chart-svg" style={{width:"100%",height:"100%"}} /></div></div>);
    }

    function EditModal({ex,onSave,onDelete,onClose}) {
      const [f,setF]=useState({name:ex.name||"",equip:ex.equip||"",sets:String(ex.sets||1),reps:String(ex.reps||"10-12"),rest:ex.rest||"90s",weight:ex.weight||ex.defaultWeight||"",cue:ex.cue||"",hold:ex.hold||"",tempo:ex.tempo||""});
      const upd=(k,v)=>setF(p=>({...p,[k]:v}));
      return (
        <div style={{color:"var(--text)"}}>
          <h3 className="font-bold" style={{marginBottom:"16px"}}>Edit Exercise</h3>
          <label className="field-label">Name</label>
          <input className="field" value={f.name} onChange={e=>upd("name",e.target.value)}/>
          <label className="field-label">Equipment</label>
          <input className="field" value={f.equip} onChange={e=>upd("equip",e.target.value)}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
            <div><label className="field-label">Sets</label><input className="field" type="number" value={f.sets} onChange={e=>upd("sets",e.target.value)}/></div>
            <div><label className="field-label">Reps</label><input className="field" value={f.reps} onChange={e=>upd("reps",e.target.value)}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
            <div><label className="field-label">Rest</label><input className="field" value={f.rest} onChange={e=>upd("rest",e.target.value)}/></div>
            <div><label className="field-label">Weight</label><input className="field" value={f.weight} onChange={e=>upd("weight",e.target.value)}/></div>
          </div>
          {f.hold&&<div><label className="field-label">Hold</label><input className="field" value={f.hold} onChange={e=>upd("hold",e.target.value)}/></div>}
          {f.tempo&&<div><label className="field-label">Tempo</label><input className="field" value={f.tempo} onChange={e=>upd("tempo",e.target.value)}/></div>}
          <label className="field-label">Cue</label>
          <textarea className="field" style={{height:"80px"}} value={f.cue} onChange={e=>upd("cue",e.target.value)}/>
          <div style={{display:"flex",gap:"10px",marginTop:"20px"}}>
            <button className="button-primary" onClick={()=>onSave({...ex,...f,sets:parseInt(f.sets)||1,defaultWeight:f.weight})}>Save</button>
            {onDelete&&<button className="button-secondary" style={{color:"var(--danger)",border:"1.5px solid var(--danger)",background:"transparent"}} onClick={onDelete}>Delete</button>}
          </div>
        </div>
      );
    }

    // ── SessionPlayer ──────────────────────────────────────────────────────────
    function SessionPlayer({routineName,routineColor,exercises,onFinish,onCancel,allWeights,allNotes,minimized,onMinimize,resume,onPersist,theme}) {
      const R = resume || {};
      const [exIdx,setExIdx]=useState(R.exIdx||0);
      const [mode,setMode]=useState(R.mode||"work");
      const [sessionPRs,setSessionPRs]=useState(R.sessionPRs||[]);
      const startTimeRef=useRef(R.startTime||Date.now());
      const [reorderMode,setReorderMode]=useState(false);
      const [showList,setShowList]=useState(R.showList!==undefined?R.showList:true);
      const [exerciseOrder,setExerciseOrder]=useState(R.exerciseOrder||exercises.map((_,i)=>i));
      const [exOverrides,setExOverrides]=useState(R.exOverrides||{});
      const orderedExercises = exerciseOrder.map(i => exOverrides[i] || exercises[i]);
      // Superset chains: exercises flagged supersetWithNext link to the one below
      const chainStart=i=>{let x=i;while(x>0&&orderedExercises[x-1]&&orderedExercises[x-1].supersetWithNext)x--;return x;};
      const chainEnd=i=>{let x=i;while(orderedExercises[x]&&orderedExercises[x].supersetWithNext&&x+1<orderedExercises.length)x++;return x;};

      // Set-by-set logging state
      const [setLogs,setSetLogs]=useState(R.setLogs||{}); // { "exIdx-setIdx": { weight, reps, seconds, logged, logId, prs } }
      const activeExRaw = orderedExercises[exIdx];
      const activeEx = activeExRaw || orderedExercises[0];
      const nextEx = exIdx+1<orderedExercises.length ? orderedExercises[exIdx+1] : null;
      const maxSets = activeEx?.sets || 1;
      const isTendonRoutine = routineName.includes("Tendon");
      const isStretchRoutine = routineName.startsWith("Stretching");

      // Current set tracking
      const [currentSetIdx, setCurrentSetIdx] = useState(R.currentSetIdx||0);

      // Side tracking for bilateral exercises
      const sideLabels = activeEx?.sideLabels || [];
      const hasSides = sideLabels.length > 0;
      const [currentSideIdx, setCurrentSideIdx] = useState(R.currentSideIdx||0);

      // Timer state
      const [targetSeconds,setTargetSeconds]=useState(90);
      const [remaining,setRemaining]=useState(90);
      const [isRunning,setIsRunning]=useState(false);
      const timerStartRef=useRef(0);
      const accRef=useRef(0);
      const rafRef=useRef(null);
      const [pendingAutoStart,setPendingAutoStart]=useState(null);
      const [isFinishedScreen,setIsFinishedScreen]=useState(R.isFinishedScreen||false);
      // History of forward transitions — enables the ← Back button (with un-logging)
      const [historyStack,setHistoryStack]=useState(R.historyStack||[]);
      const pushHistory=()=>{
        setHistoryStack(p=>[...p,{exIdx,setIdx:currentSetIdx,mode,sideIdx:currentSideIdx}]);
      };
      const [skipModal,setSkipModal]=useState(false);
      const [plateCalc,setPlateCalc]=useState(false);
      const [swapOpen,setSwapOpen]=useState(false);
      const [swapPicked,setSwapPicked]=useState({});
      const [swapQuery,setSwapQuery]=useState("");
      // Live workout duration in the header (minutes:seconds)
      const [elapsedSec,setElapsedSec]=useState(R.elapsedSec||0);
      const lastTickRef=useRef(Date.now());
      // Clock runs only while the session is open. Minimising = pausing, so a session
      // resumed hours later doesn't balloon its duration.
      useEffect(()=>{
        if(minimized) return;
        lastTickRef.current=Date.now();
        const t=setInterval(()=>{
          const now=Date.now();
          const d=Math.round((now-lastTickRef.current)/1000);
          if(d>0){ lastTickRef.current=now; setElapsedSec(s=>s+d); }
        },1000);
        return ()=>clearInterval(t);
      },[minimized]);
      // Pause the active countdown the moment the session is minimised/paused.
      useEffect(()=>{
        if(minimized && isRunningRef.current){ accRef.current+=Date.now()-timerStartRef.current; setIsRunning(false); }
      },[minimized]);
      // Persist a full snapshot so a paused session survives an app close / reload.
      useEffect(()=>{
        if(!onPersist) return;
        onPersist({
          exIdx,currentSetIdx,currentSideIdx,mode,setLogs,exerciseOrder,exOverrides,
          sessionPRs,startTime:startTimeRef.current,elapsedSec,historyStack,
          showList,isFinishedScreen
        });
      },[exIdx,currentSetIdx,currentSideIdx,mode,setLogs,exerciseOrder,exOverrides,sessionPRs,elapsedSec,historyStack,showList,isFinishedScreen]);
      // Last set of the last exercise → no point resting afterwards (chain-aware)
      const isFinalStep = si => {
        const s = si!==undefined?si:currentSetIdx;
        const cs=chainStart(exIdx), ce=chainEnd(exIdx);
        if (ce>cs) {
          const maxRounds=Math.max(...orderedExercises.slice(cs,ce+1).map(e=>e.sets||1));
          return exIdx===ce && ce+1>=orderedExercises.length && s+1>=maxRounds;
        }
        return (exIdx+1>=orderedExercises.length) && (s+1>=maxSets);
      };
      // In a superset, rest only after the LAST exercise of the chain
      const restHereOK = chainEnd(exIdx)===chainStart(exIdx) || exIdx===chainEnd(exIdx);

      const setupTimer=()=>{
        accRef.current=0;
        if(mode==="work"){
          let p=0;
          if(activeEx.hold){const s=parseInt(activeEx.hold.replace(/[^\d]/g,''))||30;p=(hasSides&&isStretchRoutine)?Math.round(s/sideLabels.length):s;setTargetSeconds(p);setRemaining(p);}
          else if(activeEx.totalSec){p=hasSides?Math.round(activeEx.totalSec/sideLabels.length):activeEx.totalSec;setTargetSeconds(p);setRemaining(p);}
          else{setTargetSeconds(0);setRemaining(0);}
          setIsRunning(false);
        } else if(mode==="rest"){
          const rs=parseRestSec(activeEx.rest);
          setTargetSeconds(rs);setRemaining(rs);
          setIsRunning(false);
        } else if(mode==="split_transition"){
          const ts=Math.max(1,parseInt(store.get('workout_transition_sec',3))||3);
          setTargetSeconds(ts);setRemaining(ts);
          timerStartRef.current=Date.now();
          setIsRunning(true);
        }
      };
      useEffect(()=>{setupTimer();},[exIdx,currentSetIdx,mode,currentSideIdx]);
      useEffect(()=>{
        if(!pendingAutoStart)return;
        if(isFinishedScreen){setPendingAutoStart(null);return;}
        if(pendingAutoStart==='rest'&&mode==='rest'){
          setPendingAutoStart(null);accRef.current=0;timerStartRef.current=Date.now();setIsRunning(true);
        } else if(pendingAutoStart==='work'&&mode==='work'){
          const hasTimer=!!(activeEx.hold||activeEx.totalSec);
          setPendingAutoStart(null);
          if(hasTimer){accRef.current=0;timerStartRef.current=Date.now();setIsRunning(true);}
        }
      },[pendingAutoStart,mode,exIdx,currentSetIdx,isFinishedScreen]);

      const modeRef=useRef(mode);
      useEffect(()=>{modeRef.current=mode;},[mode]);
      const isRunningRef=useRef(false);
      useEffect(()=>{isRunningRef.current=isRunning;},[isRunning]);
      const targetRef=useRef(targetSeconds);
      useEffect(()=>{targetRef.current=targetSeconds;},[targetSeconds]);

      // Get set key and current values
      const setKey = `${exIdx}-${currentSetIdx}`;
      const currentLog = setLogs[setKey] || {};
      // Hevy-style "previous" column: matching sets from the most recent session
      const prevSets = useMemo(() => {
        if (!activeEx) return {};
        let h = getExerciseHistory(activeEx.id);
        if (!h.length) h = getExerciseHistory(activeEx.name);
        if (!h.length) return {};
        const latestDate = h[0].date;
        const m = {};
        h.filter(x => x.date === latestDate).forEach(x => { if (x.setNumber) m[x.setNumber] = x; });
        return m;
      }, [exIdx, activeEx && activeEx.id, activeEx && activeEx.name]);
      // Target reps shown to the user = the reps you last actually lifted for this exercise,
      // falling back to the programmed target if there's no history yet.
      const displayTargetReps = useMemo(() => {
        if (!activeEx) return "";
        const last = getLastPerformance(activeEx.id, activeEx.name);
        if (last && last.reps !== undefined && last.reps !== "" && String(last.reps) !== "0") return String(last.reps);
        return activeEx.reps || "";
      }, [exIdx, activeEx && activeEx.id, activeEx && activeEx.name]);
      const getSetWeight = (si) => {
        const sk = `${exIdx}-${si}`;
        if (setLogs[sk]?.weight !== undefined) return setLogs[sk].weight;
        // Try last performance
        const lastPerf = getLastPerformance(activeEx.id, activeEx.name);
        if (lastPerf?.weight) return lastPerf.weight;
        return allWeights?.[activeEx.id] || activeEx.weight || "";
      };
      const getSetReps = (si) => {
        const sk = `${exIdx}-${si}`;
        if (setLogs[sk]?.reps !== undefined) return setLogs[sk].reps;
        const lastPerf = getLastPerformance(activeEx.id, activeEx.name);
        if (lastPerf?.reps) return lastPerf.reps;
        return activeEx.reps || "";
      };
      // Distance-metric exercises (sprints, bounds, broad jumps) log distance + effort
      // instead of weight + reps. Not timed — no hold.
      const isDistanceEx = ex => !!(ex && ex.metric==='distance');
      const getSetDist = (si) => {
        const sk = `${exIdx}-${si}`;
        if (setLogs[sk]?.dist !== undefined) return setLogs[sk].dist;
        const lastPerf = getLastPerformance(activeEx.id, activeEx.name);
        if (lastPerf?.dist) return lastPerf.dist;
        return activeEx.dist || "";
      };
      const getSetEffort = (si) => {
        const sk = `${exIdx}-${si}`;
        if (setLogs[sk]?.effort !== undefined) return setLogs[sk].effort;
        const lastPerf = getLastPerformance(activeEx.id, activeEx.name);
        if (lastPerf?.effort) return lastPerf.effort;
        return activeEx.effort || "";
      };
      const actualWeight = currentLog.weight !== undefined ? currentLog.weight : getSetWeight(currentSetIdx);
      const actualReps = currentLog.reps !== undefined ? currentLog.reps : getSetReps(currentSetIdx);
      const actualSeconds = currentLog.seconds !== undefined ? currentLog.seconds : (activeEx.hold ? String(parseInt(activeEx.hold.replace(/[^\d]/g,''))||30) : (activeEx.totalSec ? String(activeEx.totalSec) : ""));

      // Stats
      const totalSets = orderedExercises.reduce((a,e)=>a+(parseInt(e.sets)||1),0);
      const loggedSets = Object.values(setLogs).filter(l=>l.logged).length;
      const totalVolume = Object.values(setLogs).filter(l=>l.logged&&l.setType!=='warmup'&&l.metric!=='distance').reduce((acc, l) => acc + parseWeight(l.weight) * parseReps(l.reps), 0);
      const duration = Math.max(1, Math.round(elapsedSec / 60));

      const updateSetLog = (si, patch) => {
        const sk = `${exIdx}-${si}`;
        setSetLogs(p => ({...p, [sk]: {...(p[sk]||{}), ...patch}}));
      };

      const handleTimerComplete=()=>{
        setIsRunning(false);
        const m=modeRef.current;
        pushHistory();
        if(m==="work"){
          if(hasSides&&currentSideIdx+1<sideLabels.length){
            triggerSoundChecked('beep-high');
            setMode("split_transition");
          } else {
            triggerSoundChecked('chime');
            notifyTimerEnd('Hold done', activeEx && activeEx.name ? activeEx.name + ' — next up' : 'Next set');
            // Auto-log timed exercises
            if((activeEx.hold||activeEx.totalSec)&&!currentLog.logged){
              logSet(currentSetIdx);
            }
            if(activeEx.rest&&activeEx.rest!=="0s"&&!isFinalStep(currentSetIdx)&&restHereOK){
              setPendingAutoStart("rest");
              setMode("rest");
            } else {
              setPendingAutoStart("work");
              advanceSet();
            }
          }
        } else if(m==="rest"){
          triggerSoundChecked('rest-chime');
          notifyTimerEnd('Rest over','Time for your next set');
          setPendingAutoStart("work");
          advanceSet();
        } else if(m==="split_transition"){
          setPendingAutoStart("work");
          setCurrentSideIdx(currentSideIdx+1);
          setMode("work");
        }
      };

      const tick=useRef(null);
      tick.current=()=>{
        const now=Date.now();
        const elapsedMs=now-timerStartRef.current+accRef.current;
        const elapsedSec=Math.floor(elapsedMs/1000);
        const rem=Math.max(0,targetRef.current-elapsedSec);
        setRemaining(rem);
        if(rem<=0){handleTimerComplete();}
        else{rafRef.current=requestAnimationFrame(()=>tick.current());}
      };
      useEffect(()=>{
        if(isRunning){
          accRef.current=0;
          timerStartRef.current=Date.now();
          rafRef.current=requestAnimationFrame(()=>tick.current());
        } else {
          cancelAnimationFrame(rafRef.current);
        }
        return()=>cancelAnimationFrame(rafRef.current);
      },[isRunning]);

      const toggleTimer=()=>{
        if(isRunning){accRef.current+=Date.now()-timerStartRef.current;setIsRunning(false);}
        else{timerStartRef.current=Date.now();setIsRunning(true);}
      };
      const restartTimer=()=>{
        cancelAnimationFrame(rafRef.current);
        accRef.current=0;
        setRemaining(targetSeconds);
        timerStartRef.current=Date.now();
        if(isRunning) rafRef.current=requestAnimationFrame(()=>tick.current());
      };
      // Adjust the running rest/transition timer on the fly (±seconds)
      const adjustTimer=d=>{
        setTargetSeconds(t=>Math.max(5,t+d));
        if(!isRunning) setRemaining(r=>Math.max(0,r+d));
      };

      const logSet = (si) => {
        const sk = `${exIdx}-${si}`;
        if (setLogs[sk]?.logged) return;
        const logId = uid();
        // Distance-metric exercises: log distance + effort, no PR / volume.
        if (isDistanceEx(activeEx)) {
          const dist = setLogs[sk]?.dist !== undefined ? setLogs[sk].dist : getSetDist(si);
          const effort = setLogs[sk]?.effort !== undefined ? setLogs[sk].effort : getSetEffort(si);
          setSetLogs(p => ({...p, [sk]: { ...(p[sk]||{}), dist, effort, metric:'distance', reps: dist, weight: '', logged: true, logId }}));
          const progD = store.get("workout_progression", []);
          progD.push({ id: logId, date: todayStr(), exercise: activeEx.name, exerciseId: activeEx.id, metric:'distance', dist, effort, reps: dist, weight: '', hold: '0', setNumber: si + 1, setType: 'normal' });
          store.set("workout_progression", progD);
          return;
        }
        const w = setLogs[sk]?.weight !== undefined ? setLogs[sk].weight : getSetWeight(si);
        const r = setLogs[sk]?.reps !== undefined ? setLogs[sk].reps : getSetReps(si);
        const s = setLogs[sk]?.seconds !== undefined ? setLogs[sk].seconds : actualSeconds;

        const setType = setLogs[sk]?.setType;
        const rir = setLogs[sk]?.rir;
        // Check PRs — warm-up sets never count
        const prs = setType==='warmup' ? [] : checkForPRs(activeEx.id, activeEx.name, w, r);
        if (prs.length > 0 && !prs.includes('first')) {
          triggerSound('pr-fanfare');
          try { navigator.vibrate?.([50, 30, 50]); } catch {}
          setSessionPRs(prev => [...prev, { exercise: activeEx.name, exerciseId: activeEx.id, prs, weight: w, reps: r }]);
          try { const h = store.get("pr_history", []); prs.forEach(type => h.push({ date: todayStr(), exercise: activeEx.name, type, weight: w, reps: r })); store.set("pr_history", h); } catch {}
        }

        setSetLogs(p => ({...p, [sk]: { ...(p[sk]||{}), weight: w, reps: r, seconds: s, logged: true, logId, prs }}));
        // Save to progression
        const prog = store.get("workout_progression", []);
        prog.push({ id: logId, date: todayStr(), exercise: activeEx.name, exerciseId: activeEx.id, weight: w, reps: r, hold: s || "0", setNumber: si + 1, setType: setType||"normal", rir: rir!==undefined&&rir!==""?rir:undefined });
        store.set("workout_progression", prog);
      };

      const advanceSet = () => {
        setCurrentSideIdx(0);
        const cs=chainStart(exIdx), ce=chainEnd(exIdx);
        if (ce>cs) {
          // Superset round: A → B → … → rest → back to A, next round
          if (exIdx < ce) {
            const ni=exIdx+1;
            setExIdx(ni);
            setCurrentSetIdx(Math.min(currentSetIdx,(orderedExercises[ni].sets||1)-1));
            setMode("work");
            return;
          }
          const maxRounds=Math.max(...orderedExercises.slice(cs,ce+1).map(e=>e.sets||1));
          if (currentSetIdx+1 < maxRounds) {
            setExIdx(cs);
            setCurrentSetIdx(currentSetIdx+1);
            setMode("work");
            return;
          }
          if (ce+1 < orderedExercises.length) { setExIdx(ce+1); setCurrentSetIdx(0); setMode("work"); }
          else setIsFinishedScreen(true);
          return;
        }
        if (currentSetIdx + 1 < maxSets) {
          setCurrentSetIdx(currentSetIdx + 1);
          setMode("work");
        } else {
          if (exIdx + 1 < orderedExercises.length) {
            setExIdx(exIdx + 1);
            setCurrentSetIdx(0);
            setMode("work");
          } else {
            setIsFinishedScreen(true);
          }
        }
      };

      const handleCompleteSet = (si) => {
        const sk = `${exIdx}-${si}`;
        setIsRunning(false);
        pushHistory();
        if (setLogs[sk]?.logged) {
          // Already logged, just advance
          if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(si) && restHereOK) {
            setPendingAutoStart("rest");
            setMode("rest");
          } else {
            setPendingAutoStart("work");
            advanceSet();
          }
          return;
        }
        logSet(si);
        try { navigator.vibrate?.(50); } catch {}
        // Auto-start rest timer
        if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(si) && restHereOK) {
          setPendingAutoStart("rest");
          setMode("rest");
        } else {
          // Move to next set
          if (si === currentSetIdx) {
            setPendingAutoStart("work");
            advanceSet();
          }
        }
      };

      // Skip the current set without logging (used by the skip modal)
      const doSkipSet = () => {
        setIsRunning(false);
        pushHistory();
        if (hasSides && (activeEx.hold||activeEx.totalSec) && currentSideIdx + 1 < sideLabels.length) {
          setPendingAutoStart("work");
          setMode("split_transition");
        } else if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(currentSetIdx) && restHereOK) {
          setPendingAutoStart("rest");
          setMode("rest");
        } else {
          setPendingAutoStart("work");
          advanceSet();
        }
      };

      const skipToNext = () => {
        if (mode === "work") {
          // Ask whether to log the set as done or skip without logging
          setSkipModal(true);
          return;
        }
        // Skipping rest needs no confirmation
        setIsRunning(false);
        pushHistory();
        setPendingAutoStart("work");
        advanceSet();
      };

      // Skip the whole exercise without logging anything
      const skipExercise = () => {
        setIsRunning(false);
        pushHistory();
        setCurrentSideIdx(0);
        if (exIdx + 1 < orderedExercises.length) {
          setExIdx(exIdx + 1);
          setCurrentSetIdx(0);
          setPendingAutoStart("work");
          setMode("work");
        } else {
          setIsFinishedScreen(true);
        }
      };

      // ← Back: revert to the previous step; if that step had a logged set, un-log it
      const goBack = () => {
        if (!historyStack.length) return;
        setIsRunning(false);
        setPendingAutoStart(null);
        const prev = historyStack[historyStack.length - 1];
        setHistoryStack(h => h.slice(0, -1));
        const sk = `${prev.exIdx}-${prev.setIdx}`;
        const log = setLogs[sk];
        if (prev.mode === "work" && log?.logged) {
          if (log.logId) {
            const p = store.get("workout_progression", []);
            store.set("workout_progression", p.filter(item => item.id !== log.logId));
          }
          setSetLogs(s => ({...s, [sk]: {...(s[sk]||{}), logged: false, logId: undefined, prs: undefined}}));
          if (log.prs && log.prs.length && !log.prs.includes('first')) {
            // Drop the matching session PR entry (first match)
            setSessionPRs(prs => {
              const i = prs.findIndex(x => x.exerciseId === orderedExercises[prev.exIdx]?.id && x.weight === log.weight && x.reps === log.reps);
              return i >= 0 ? [...prs.slice(0, i), ...prs.slice(i + 1)] : prs;
            });
          }
        }
        setExIdx(prev.exIdx);
        setCurrentSetIdx(prev.setIdx);
        setCurrentSideIdx(prev.sideIdx || 0);
        setMode(prev.mode);
      };

      const reorderExercise = (fromIdx, dir) => {
        const toIdx = fromIdx + dir;
        if (toIdx < 0 || toIdx >= exerciseOrder.length) return;
        const newOrder = [...exerciseOrder];
        [newOrder[fromIdx], newOrder[toIdx]] = [newOrder[toIdx], newOrder[fromIdx]];
        setExerciseOrder(newOrder);
      };

      const onFinishSession = () => {
        const logs = store.get("workout_logs", []);
        logs.push({ id: uid(), date: todayStr(), routine: routineName, total: totalSets, completed: loggedSets, isPartial: loggedSets < totalSets, duration, volume: totalVolume });
        store.set('workout_last_routine',{name:routineName,color:routineColor||null,exercises,date:todayStr()});
        bumpBackupCounter();
        store.set("workout_logs", logs);
        const c = store.get("workout_completed_counts", { workouts: 0, tendons: 0, stretches: 0 });
        if (loggedSets > 0) {
          if (routineName.includes("Stretch")) c.stretches += 1;
          else if (routineName.includes("Tendon")) c.tendons += 1;
          else c.workouts += 1;
        }
        store.set("workout_completed_counts", c);
        onFinish();
      };

      const progressPercent=targetSeconds>0?((targetSeconds-remaining)/targetSeconds)*100:0;
      const strokeDashoffset=628-(628*progressPercent)/100;
      const suggestion = getProgressionSuggestion(activeEx?.id, activeEx?.name, activeEx?.reps);
      const exNote = allNotes?.[activeEx?.id];

      // ── Reorder Mode ──
      if (reorderMode) {
        return (
          <div className="timer-overlay" style={{...accentVars(routineColor),...(minimized?{display:"none"}:{})}}>
            <div className="flex-between" style={{marginBottom:"16px"}}>
              <h2 className="font-bold" style={{fontSize:"20px"}}>Reorder Exercises</h2>
              <button className="button-secondary" style={{width:"auto",padding:"8px 16px"}} onClick={() => setReorderMode(false)}>Done</button>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {exerciseOrder.map((origIdx, orderIdx) => {
                const ex = exercises[origIdx];
                return (
                  <div key={origIdx} className="card" style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                      <button className="reorder-btn" onClick={() => reorderExercise(orderIdx, -1)} disabled={orderIdx === 0}>▲</button>
                      <button className="reorder-btn" onClick={() => reorderExercise(orderIdx, 1)} disabled={orderIdx === exerciseOrder.length - 1}>▼</button>
                    </div>
                    <div style={{flex:1}}>
                      <p className="font-bold" style={{fontSize:"14px"}}>{ex.name}</p>
                      <p className="text-small" style={{fontSize:"11px"}}>{ex.equip} — {ex.sets} sets</p>
                    </div>
                    <span className="exercise-count-badge">{orderIdx + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // ── Finished Screen ──
      if(isFinishedScreen){
        const streaks = calculateStreaks();
        // Compare against the most recent prior session of this same routine
        const priorSessions = store.get("workout_logs",[]).filter(l=>l.routine===routineName && l.date!==todayStr());
        const lastSession = priorSessions.sort((a,b)=>b.date.localeCompare(a.date))[0];
        const volDelta = (lastSession && lastSession.volume>0 && totalVolume>0) ? Math.round((totalVolume/lastSession.volume-1)*100) : null;
        const fmtDelta = d => d===null?null : d>0?`up ${d}%`:d<0?`down ${Math.abs(d)}%`:"same";
        return (
          <div className="timer-overlay" style={{...accentVars(routineColor),justifyContent:"center",alignItems:"center",textAlign:"center",padding:"40px 24px",...(minimized?{display:"none"}:{})}}>
            <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",maxWidth:"400px",width:"100%"}}>
              {sessionPRs.length>0 && <Confetti/>}
              <div style={{width:"72px",height:"72px",borderRadius:"50%",background:"var(--accent-muted)",border:"1.5px solid var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--accent)",marginBottom:"20px"}}><Icons.Trophy size={34}/></div>
              <h1 style={{fontSize:"30px",fontWeight:"900",lineHeight:"1.15",marginBottom:"8px",letterSpacing:"-0.02em"}}>{(()=>{const n=(store.get('user_profile',{})||{}).name||store.get('workout_username','');return n?`Nice work, ${n}!`:"Nice work!";})()}</h1>
              <p style={{fontSize:"17px",color:"var(--text-secondary)",marginBottom:"24px"}}>You finished {routineName}!</p>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",width:"100%",marginBottom:"16px"}}>
                <div className="card summary-stat"><div className="stat-value text-accent">{loggedSets}</div><div className="stat-label">Sets</div></div>
                <div className="card summary-stat"><div className="stat-value text-accent">{duration}</div><div className="stat-label">Minutes</div></div>
                <div className="card summary-stat"><div className="stat-value text-accent">{totalVolume > 0 ? `${Math.round(totalVolume).toLocaleString()}` : '—'}</div><div className="stat-label">Volume kg</div></div>
              </div>

              {volDelta!==null && (
                <div className="card" style={{width:"100%",marginBottom:"16px",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",borderColor:volDelta>=0?"var(--success)":"var(--card-border)"}}>
                  <span style={{color:volDelta>0?"var(--success)":volDelta<0?"var(--warning)":"var(--text-secondary)",fontWeight:"900",fontSize:"18px"}}>{volDelta>0?"▲":volDelta<0?"▼":"="}</span>
                  <span className="text-small">Volume {fmtDelta(volDelta)} vs last {routineName} ({Math.round(lastSession.volume).toLocaleString()} kg)</span>
                </div>
              )}

              {sessionPRs.length > 0 && (
                <div className="card" style={{width:"100%",marginBottom:"16px",textAlign:"left"}}>
                  <p className="font-bold" style={{marginBottom:"8px",display:"flex",alignItems:"center",gap:"6px"}}><span style={{color:"var(--pr-gold)"}}><Icons.Trophy size={16}/></span> New Personal Records</p>
                  {sessionPRs.map((pr, i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i < sessionPRs.length - 1 ? "0.5px solid var(--card-border)" : "none"}}>
                      <span className="font-bold" style={{fontSize:"14px"}}>{pr.exercise}</span>
                      <div style={{display:"flex",gap:"4px"}}>
                        {pr.prs.map(p => <span key={p} className="pr-badge">{p === 'weight' ? 'Weight PR' : p === 'reps' ? 'Reps PR' : '1RM PR'}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(streaks.current > 0 || streaks.longest > 0) && (
                <div className="card streak-card" style={{width:"100%",marginBottom:"16px",textAlign:"left"}}>
                  <div style={{display:"flex",gap:"24px"}}>
                    <div><p className="text-small font-bold" style={{textTransform:"uppercase",fontSize:"10px"}}>Current Streak</p><p style={{fontSize:"24px",fontWeight:"900",color:"var(--warning)"}}>{streaks.current + 1} days</p></div>
                    <div><p className="text-small font-bold" style={{textTransform:"uppercase",fontSize:"10px"}}>Longest</p><p style={{fontSize:"24px",fontWeight:"900"}}>{Math.max(streaks.longest, streaks.current + 1)} days</p></div>
                  </div>
                </div>
              )}
            </div>

            <div style={{width:"100%",maxWidth:"400px",display:"flex",flexDirection:"column",gap:"12px"}}>
              <button className="button-primary" style={{padding:"18px",fontSize:"18px",borderRadius:"16px"}} onClick={onFinishSession}>Finish & Log Workout</button>
              <button className="button-secondary" style={{color:"var(--danger)",borderColor:"var(--danger)",background:"transparent"}} onClick={()=>{
                if(confirm("Discard all logged sets?")){
                  const logIds = Object.values(setLogs).filter(l=>l.logged&&l.logId).map(l=>l.logId);
                  if(logIds.length>0){const p=store.get("workout_progression",[]);store.set("workout_progression",p.filter(item=>!logIds.includes(item.id)));}
                  onCancel();
                }
              }}>Discard Workout</button>
            </div>
          </div>
        );
      }

      // ── Exercise Overview / List (shown at session start & on demand) ──
      const exSummary = (ex) => {
        const sets = ex?.sets || 1;
        if (isDistanceEx(ex)) return `${sets} × ${ex.dist || 'distance'}${ex.effort ? ` · ${ex.effort}` : ''}`;
        if (ex?.hold) return `${sets} × ${ex.hold} hold`;
        if (ex?.totalSec) return `${ex.totalSec}s`;
        return `${sets} × ${ex?.reps || '—'}${ex?.weight ? ` · ${ex.weight}` : ''}`;
      };
      const exStatusOf = (i) => {
        const ex = orderedExercises[i];
        const sets = ex?.sets || 1;
        let done = 0;
        for (let s = 0; s < sets; s++) if (setLogs[`${i}-${s}`]?.logged) done++;
        if (sets > 0 && done >= sets) return 'done';
        if (done > 0) return 'inprogress';
        if (i === exIdx) return 'current';
        return 'todo';
      };
      const doneCount = orderedExercises.filter((_, i) => exStatusOf(i) === 'done').length;
      if (showList && !reorderMode && !isFinishedScreen) {
        const begun = loggedSets > 0;
        return (
          <div className="timer-overlay" style={{...accentVars(routineColor),...(minimized?{display:"none"}:{})}}>
            <div className="flex-between" style={{marginBottom:"6px"}}>
              <span className="badge" style={{marginLeft:0}}>{routineName}</span>
              <button onClick={onMinimize} title="Pause — keep session for later" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"7px 12px",fontSize:"13px",fontWeight:"800",display:"inline-flex",alignItems:"center",gap:"6px"}}><Icons.Pause size={14}/> Pause</button>
            </div>
            <h2 className="font-bold" style={{fontSize:"26px",letterSpacing:"-0.02em",marginBottom:"2px"}}>{begun ? "Session in progress" : "Today's exercises"}</h2>
            <p className="text-small" style={{marginBottom:"4px"}}>{doneCount} of {orderedExercises.length} done · {loggedSets} of {totalSets} sets logged</p>
            <div style={{height:"6px",borderRadius:"3px",background:"var(--input-bg)",overflow:"hidden",margin:"10px 0 18px"}}>
              <div style={{height:"100%",width:`${totalSets?Math.round(loggedSets/totalSets*100):0}%`,background:"var(--accent)",borderRadius:"3px",transition:"width 0.3s ease"}}/>
            </div>
            <div style={{flex:1,overflowY:"auto",margin:"0 -4px"}}>
              <div className="list-group">
                {orderedExercises.map((ex, i) => {
                  const st = exStatusOf(i);
                  const isCur = i === exIdx;
                  return (
                    <button key={i} className="list-row" onClick={()=>{ setIsRunning(false); setExIdx(i); setCurrentSetIdx(0); setCurrentSideIdx(0); setMode("work"); setShowList(false); }}>
                      <span className="lr-icon" style={{
                        background: st==='done'?"var(--accent)":st==='todo'?"var(--input-bg)":"var(--accent-muted)",
                        color: st==='done'?"var(--btn-text)":"var(--accent)",
                        border: isCur&&st!=='done'?"1.5px solid var(--accent)":"none"}}>
                        {st==='done' ? <svg width="15" height="15" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>
                          : <span style={{fontSize:"13px",fontWeight:"800"}}>{i+1}</span>}
                      </span>
                      <span className="lr-body">
                        <span className="lr-title" style={{textDecoration:st==='done'?"none":"none",opacity:st==='done'?0.65:1}}>{ex.name}</span>
                        <span className="lr-sub">{exSummary(ex)}{tendonExHasSides(ex)?" · L+R":""}</span>
                      </span>
                      <span className="lr-trail">
                        {st==='done' && <span style={{fontSize:"11px",fontWeight:"800",color:"var(--accent)"}}>DONE</span>}
                        {st==='inprogress' && <span style={{fontSize:"11px",fontWeight:"800",color:"var(--text-secondary)"}}>PART</span>}
                        {isCur && st!=='done' && <span style={{fontSize:"11px",fontWeight:"800",color:"var(--accent)"}}>NOW</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px",paddingTop:"14px"}}>
              <button className="button-primary" style={{padding:"16px",fontSize:"17px",borderRadius:"14px"}} onClick={()=>setShowList(false)}>{begun ? "Resume session" : "Begin session"}</button>
              <button className="button-secondary" style={{color:"var(--danger)",borderColor:"var(--danger)",background:"transparent",padding:"12px"}} onClick={()=>{
                if(!begun){ onCancel(); return; }
                if(confirm("End this session? Logged sets are kept.")) setIsFinishedScreen(true);
              }}>{begun ? "End session" : "Cancel"}</button>
            </div>
          </div>
        );
      }

      // ── Active Workout ──
      return (
        <div className="timer-overlay" style={{...accentVars(routineColor),...(minimized?{display:"none"}:{})}}>
          <div className="flex-between" style={{width:"100%",marginBottom:"10px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
              <div>
                <span className="badge" style={{marginLeft:"0"}}>{routineName}</span>
                <p className="text-small" style={{marginTop:"4px"}}>Ex {exIdx+1}/{orderedExercises.length} — Set {currentSetIdx+1}/{maxSets} — {loggedSets}/{totalSets} logged — {fmtTime(elapsedSec)}{chainEnd(exIdx)>chainStart(exIdx)?" — superset":""}</p>
              </div>
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"flex-end"}}>
              <button onClick={()=>setShowList(true)} title="Exercise list" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"7px 10px",display:"inline-flex",alignItems:"center"}}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><line x1="3.5" y1="6" x2="3.51" y2="6"/><line x1="3.5" y1="12" x2="3.51" y2="12"/><line x1="3.5" y1="18" x2="3.51" y2="18"/></svg></button>
              <button onClick={onMinimize} title="Pause — keep session for later" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"6px 12px",fontSize:"13px",fontWeight:"800",display:"inline-flex",alignItems:"center",gap:"6px"}}><Icons.Pause size={13}/> Pause</button>
              {historyStack.length>0&&<button onClick={goBack} style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"6px 12px",fontSize:"13px",fontWeight:"800"}}>← Back</button>}
              {!(activeEx.hold||activeEx.totalSec||isDistanceEx(activeEx))&&<button onClick={()=>setPlateCalc(true)} title="Plate calculator" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"7px 10px",display:"inline-flex",alignItems:"center"}}><Icons.Plate/></button>}
              <button onClick={()=>setSwapOpen(true)} title="Swap exercise" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"7px 10px",display:"inline-flex",alignItems:"center"}}><Icons.Swap/></button>
              <button onClick={() => setReorderMode(true)} title="Reorder" style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"6px 10px",fontSize:"12px",fontWeight:"700"}}>⇅</button>
              <button style={{border:"1.5px solid var(--danger)",color:"var(--danger)",background:"transparent",borderRadius:"10px",padding:"6px 14px",fontSize:"13px",fontWeight:"800",textTransform:"uppercase"}} onClick={()=>setIsFinishedScreen(true)}>Finish</button>
            </div>
          </div>

          <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center"}}>
            {mode==="split_transition"&&<div className="card text-warning" style={{borderColor:"var(--warning)",width:"100%",textAlign:"center",padding:"12px",fontSize:"18px",fontWeight:"800"}}>Change side — {sideLabels[currentSideIdx+1]}</div>}
            <h2 className="font-bold" style={{fontSize:"24px",textAlign:"center",marginBottom:"4px"}}>{activeEx.name}</h2>
            <p className="text-small font-bold" style={{textTransform:"uppercase",letterSpacing:"0.05em",color:"var(--accent)"}}>
              {mode==="work"&&(hasSides?((activeEx.hold||activeEx.totalSec)?`${sideLabels[currentSideIdx]} hold`:"Both sides — L + R"):"Active Work")}
              {mode==="rest"&&"Resting"}
              {mode==="split_transition"&&"Transition"}
            </p>

            {/* Previous Performance Banner */}
            {mode === "work" && <PreviousPerformanceBanner exerciseId={activeEx.id} exerciseName={activeEx.name}/>}

            {/* Progression Suggestion */}
            {mode === "work" && suggestion && (
              <div className={`suggestion-badge ${suggestion.type}`} style={{marginBottom:"8px"}}>
                {suggestion.type === 'up' ? '↑' : suggestion.type === 'down' ? '↓' : '→'} {suggestion.msg}
              </div>
            )}

            {/* Exercise Note */}
            {mode === "work" && exNote && (
              <div style={{width:"100%",background:"var(--warning-muted)",border:"1px solid var(--warning)",borderRadius:"10px",padding:"8px 12px",fontSize:"12px",color:"var(--warning)",marginBottom:"8px"}}>
                📝 {exNote}
              </div>
            )}

            {/* Timer circle for timed exercises */}
            {((mode==="work"&&targetSeconds>0)||mode==="rest"||mode==="split_transition")?(
              <div className="timer-circle-container" style={{width:"230px",height:"230px",margin:"24px auto"}}>
                <svg className="timer-circle-svg" viewBox="0 0 220 220">
                  <circle className="timer-circle-bg" cx="110" cy="110" r="100"/>
                  <circle className="timer-circle-progress" cx="110" cy="110" r="100" strokeDasharray="628" strokeDashoffset={strokeDashoffset}/>
                </svg>
                <div className="timer-display" style={{fontSize:"56px"}}><span>{fmtTime(remaining)}</span><span className="timer-label">{mode==="work"?"hold":"rest"}</span></div>
              </div>
            ):(
              mode==="work"&&<div style={{margin:"22px auto",textAlign:"center"}}>
                <div className="stat-num" style={{fontSize:isDistanceEx(activeEx)&&!activeEx.dist?"42px":"68px",fontWeight:"900",lineHeight:"1"}}>{isDistanceEx(activeEx)?(activeEx.dist||"Distance"):(displayTargetReps||activeEx.reps)}</div>
                <div className="timer-label" style={{fontSize:"13px",marginTop:"6px"}}>{isDistanceEx(activeEx)?(activeEx.effort?`Target effort ${activeEx.effort}`:"Log your distance"):`Target Reps${hasSides?" — each side":""}`}</div>
              </div>
            )}

            {/* Cue */}
            {mode==="work"&&activeEx.cue&&(
              <div className="exercise-cue-box" style={{width:"100%",maxHeight:"80px",overflowY:"auto",margin:"4px 0 8px"}}>
                <strong style={{display:"block",fontSize:"11px",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"2px",color:"var(--text-secondary)"}}>Cue</strong>
                {activeEx.cue}
              </div>
            )}

            {/* Set-by-set logging table */}
            {mode==="work"&&!isStretchRoutine&&(
              <div className="card" style={{width:"100%",padding:"10px",marginBottom:"0"}}>
                <table className="set-table">
                  <thead>
                    <tr>
                      <th style={{width:"40px"}}>Set</th>
                      {isDistanceEx(activeEx) ? (<><th>Distance</th><th>Effort</th></>) : (<>
                        {!(activeEx.hold||activeEx.totalSec) && <th>Weight</th>}
                        {!(activeEx.hold||activeEx.totalSec) ? <th>Reps</th> : <th>Seconds</th>}
                        {!(activeEx.hold||activeEx.totalSec) && <th style={{width:"44px"}}>RIR</th>}
                      </>)}
                      <th style={{width:"50px"}}>Done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({length: maxSets}, (_, si) => {
                      const sk = `${exIdx}-${si}`;
                      const log = setLogs[sk] || {};
                      const isActive = si === currentSetIdx && !log.logged;
                      const isDone = !!log.logged;
                      const isHold = !!(activeEx.hold||activeEx.totalSec);
                      const isDist = isDistanceEx(activeEx);
                      const isBW = !!(activeEx.equip&&/bodyweight|bw/i.test(activeEx.equip));
                      const sw = log.weight !== undefined ? log.weight : getSetWeight(si);
                      const sr = log.reps !== undefined ? log.reps : getSetReps(si);
                      const ss = log.seconds !== undefined ? log.seconds : actualSeconds;
                      const sd = log.dist !== undefined ? log.dist : getSetDist(si);
                      const se = log.effort !== undefined ? log.effort : getSetEffort(si);
                      return (
                        <tr key={si} className={isActive ? "active-set" : isDone ? "completed-set" : ""}>
                          <td>
                            <button onClick={()=>{ if(isDone) return; const cycle=[undefined,'warmup','drop','failure']; const cur=cycle.indexOf(log.setType); updateSetLog(si,{setType:cycle[(cur+1)%cycle.length]}); }}
                              title="Tap: Warm-up / Drop / Failure"
                              style={{fontWeight:"800",minWidth:"26px",padding:"4px 6px",borderRadius:"8px",
                                color:log.setType==='warmup'?"var(--warning)":log.setType==='drop'?"var(--accent)":log.setType==='failure'?"var(--danger)":"var(--text)",
                                background:log.setType?"var(--input-bg)":"transparent"}}>
                              {log.setType==='warmup'?'W':log.setType==='drop'?'D':log.setType==='failure'?'F':si+1}
                            </button>
                          </td>
                          {isDist ? (<>
                            <td>
                              {isDone ? <span className="font-bold">{sd||"—"}</span> :
                                <input className="set-input" value={sd} onChange={e => updateSetLog(si, {dist: e.target.value})} placeholder="e.g. 20m" style={{width:"68px"}}/>}
                              {!isDone && prevSets[si+1] && prevSets[si+1].dist && <div style={{fontSize:"9px",color:"var(--text-secondary)",opacity:0.75,marginTop:"2px"}}>prev {prevSets[si+1].dist}</div>}
                            </td>
                            <td>
                              {isDone ? <span className="font-bold">{se||"—"}</span> :
                                <input className="set-input" value={se} onChange={e => updateSetLog(si, {effort: e.target.value})} placeholder="effort" style={{width:"64px"}}/>}
                              {!isDone && prevSets[si+1] && prevSets[si+1].effort && <div style={{fontSize:"9px",color:"var(--text-secondary)",opacity:0.75,marginTop:"2px"}}>prev {prevSets[si+1].effort}</div>}
                            </td>
                          </>) : (<>
                          {!isHold && (
                            <td>
                              {isDone ? <span className="font-bold">{sw}</span> :
                                <input className="set-input" inputMode="decimal" value={sw} onChange={e => updateSetLog(si, {weight: decOnly(e.target.value)})} placeholder="kg"/>}
                              {!isDone && prevSets[si+1] && <div style={{fontSize:"9px",color:"var(--text-secondary)",opacity:0.75,marginTop:"2px"}}>prev {prevSets[si+1].weight&&prevSets[si+1].weight!=="0"?fmtWeight(prevSets[si+1].weight):"BW"}{prevSets[si+1].reps?` × ${prevSets[si+1].reps}`:""}</div>}
                            </td>
                          )}
                          {!isHold ? (
                            <td>
                              {isDone ? <span className="font-bold">{sr}</span> :
                                <input className="set-input" inputMode="numeric" value={sr} onChange={e => updateSetLog(si, {reps: numOnly(e.target.value)})} placeholder="reps" style={{width:"50px"}}/>}
                            </td>
                          ) : (
                            <td>
                              {isDone ? <span className="font-bold">{ss}s</span> :
                                <input className="set-input" inputMode="numeric" value={ss} onChange={e => updateSetLog(si, {seconds: numOnly(e.target.value)})} placeholder="sec" style={{width:"50px"}}/>}
                              {!isDone && prevSets[si+1] && prevSets[si+1].hold && prevSets[si+1].hold!=="0" && <div style={{fontSize:"9px",color:"var(--text-secondary)",opacity:0.75,marginTop:"2px"}}>prev {prevSets[si+1].hold}</div>}
                            </td>
                          )}
                          {!isHold && (
                            <td>
                              {isDone ? <span className="text-small" style={{fontWeight:"700"}}>{log.rir!==undefined&&log.rir!==""?log.rir:"—"}</span> :
                                <select className="set-input" style={{width:"40px",padding:"4px 2px"}} value={log.rir??""} onChange={e=>updateSetLog(si,{rir:e.target.value})}>
                                  <option value="">—</option>
                                  {["0","1","2","3","4","5"].map(o=><option key={o} value={o}>{o}</option>)}
                                </select>}
                            </td>
                          )}
                          </>)}
                          <td>
                            <button className={`set-done-btn ${isDone ? 'done' : 'pending'}`} onClick={() => { if (!isDone) { setCurrentSetIdx(si); handleCompleteSet(si); } }}>
                              {isDone ? '✓' : '○'}
                            </button>
                            {log.prs && log.prs.length > 0 && !log.prs.includes('first') && <div className="pr-badge" style={{marginTop:"4px",fontSize:"9px"}}>PR</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Rest — Up Next */}
            {mode==="rest"&&nextEx&&(
              <div className="card" style={{width:"100%",background:"var(--input-bg)"}}>
                <p className="text-small font-bold" style={{textTransform:"uppercase",color:"var(--accent)"}}>Up Next</p>
                <p className="font-bold" style={{fontSize:"16px",marginTop:"2px"}}>{nextEx.name}</p>
                <p className="text-small" style={{fontSize:"12px"}}>{nextEx.equip} — {nextEx.sets} set{nextEx.sets>1?"s":""} — {nextEx.dist||nextEx.reps||nextEx.hold}</p>
              </div>
            )}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"12px",alignItems:"center"}}>
            {((mode==="work"&&targetSeconds>0)||mode==="rest")&&(
              <div style={{display:"flex",gap:"24px",alignItems:"center"}}>
                <button className="restart-btn" onClick={restartTimer}><Icons.Refresh size={22}/></button>
                <button className="play-pause-btn" onClick={toggleTimer}>{isRunning?<Icons.Pause size={28}/>:<Icons.Play size={28}/>}</button>
                <div style={{width:"52px"}}/>
              </div>
            )}
            {mode==="rest"&&(
              <div style={{display:"flex",gap:"10px",justifyContent:"center"}}>
                <button className="button-secondary" style={{width:"auto",padding:"8px 16px",fontSize:"13px"}} onClick={()=>adjustTimer(-15)}>−15s</button>
                <button className="button-secondary" style={{width:"auto",padding:"8px 16px",fontSize:"13px"}} onClick={()=>adjustTimer(15)}>+15s</button>
              </div>
            )}
            {mode==="rest"?(
              <button className="button-secondary" style={{maxWidth:"260px",width:"100%"}} onClick={skipToNext}>Skip Rest</button>
            ):(
              <div style={{display:"grid",gridTemplateColumns:(mode==="work"&&!(activeEx.hold||activeEx.totalSec))?"1fr 1fr":"1fr",gap:"10px",width:"100%"}}>
                <button className="button-secondary" onClick={skipToNext}>Skip →</button>
                {mode==="work"&&!(activeEx.hold||activeEx.totalSec)&&<button className="button-primary" onClick={() => handleCompleteSet(currentSetIdx)} disabled={setLogs[setKey]?.logged} style={{opacity:setLogs[setKey]?.logged?0.4:1}}>
                  {setLogs[setKey]?.logged ? "Logged ✓" : "Complete Set"}
                </button>}
              </div>
            )}
          </div>

          {/* Swap exercise (machine taken, etc.) */}
          {swapOpen&&(
            <div className="modal-bg" style={{zIndex:200}} onClick={e=>{if(e.target===e.currentTarget){setSwapOpen(false);setSwapPicked({});setSwapQuery("");}}}>
              <div className="modal-body">
                <div className="drag-bar"/>
                <h3 className="font-bold" style={{fontSize:"19px",marginBottom:"4px"}}>Swap "{activeEx.name}"</h3>
                <p className="text-small" style={{marginBottom:"12px"}}>Pick a replacement — its sets stay at {maxSets}. Logged sets for this slot are cleared.</p>
                <ExercisePickList sections={null} picked={swapPicked} setPicked={setSwapPicked} query={swapQuery} setQuery={setSwapQuery} single/>
                <button className="button-primary" style={{marginTop:"12px"}} disabled={!Object.keys(swapPicked).length} onClick={()=>{
                  const it=Object.values(swapPicked)[0];
                  if(!it)return;
                  const base=it.src?{...it.src}:{id:uid(),name:it.name,equip:it.equip,reps:activeEx.reps||"8-12",hold:activeEx.hold||"",rest:activeEx.rest||"90s",weight:"",cue:it.cue||""};
                  const underlying=exerciseOrder[exIdx];
                  setExOverrides(o=>({...o,[underlying]:withSides({...base,id:uid(),sets:activeEx.sets||base.sets||3})}));
                  setSetLogs(p=>{const u={...p};Object.keys(u).forEach(k=>{if(k.startsWith(`${exIdx}-`))delete u[k];});return u;});
                  setIsRunning(false);setCurrentSideIdx(0);setCurrentSetIdx(0);setMode("work");
                  setSwapOpen(false);setSwapPicked({});setSwapQuery("");
                }}>Swap in</button>
                <button className="button-secondary" style={{marginTop:"10px"}} onClick={()=>{setSwapOpen(false);setSwapPicked({});setSwapQuery("");}}>Cancel</button>
              </div>
            </div>
          )}
          {/* Skip choice modal */}
          {plateCalc&&<PlateCalcModal initialWeight={currentLog.weight!==undefined?currentLog.weight:getSetWeight(currentSetIdx)} onClose={()=>setPlateCalc(false)}/>}
          {skipModal&&(
            <div className="modal-bg" style={{zIndex:200}} onClick={e=>{if(e.target===e.currentTarget)setSkipModal(false);}}>
              <div className="modal-body">
                <div className="drag-bar"/>
                <h3 className="font-bold" style={{fontSize:"19px",marginBottom:"4px"}}>Skip — {activeEx.name}</h3>
                <p className="text-small" style={{marginBottom:"16px"}}>Set {currentSetIdx+1} of {maxSets}</p>
                <button className="button-primary" onClick={()=>{setSkipModal(false);handleCompleteSet(currentSetIdx);}}>Log set as done & skip</button>
                <button className="button-secondary" style={{marginTop:"10px"}} onClick={()=>{setSkipModal(false);doSkipSet();}}>Skip set without logging</button>
                <button className="button-secondary" style={{marginTop:"10px"}} onClick={()=>{setSkipModal(false);skipExercise();}}>Skip whole exercise (no log)</button>
                <button style={{marginTop:"14px",width:"100%",padding:"10px",fontWeight:"700",color:"var(--text-secondary)"}} onClick={()=>setSkipModal(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      );
    }

    // ── WorkoutsTab ────────────────────────────────────────────────────────────
    function WorkoutsTab({workouts,setWorkouts,weights,saveWeight,customReps,saveReps,counts,setActiveRoutine,setModalContent,reloadLogs,theme,notes,saveNote,tileColor}) {
      const [activeSection,setActiveSection]=useState(null);
      const [editMode,setEditMode]=useState(false);
      const [draftNames,setDraftNames]=useState({});
      const [checkedExercises,setCheckedExercises]=useState({});
      const [inlineEdit,setInlineEdit]=useState(null);
      const [historyModal,setHistoryModal]=useState(null);
      const workoutSections=workouts.filter(s=>!(s.description||s.phases));

      const saveW=u=>{setWorkouts(u);store.set("workout_sections_custom",u);};
      const moveExercise=(secName,idx,dir)=>{
        const sec=workouts.find(s=>s.section===secName);if(!sec)return;
        const exs=[...sec.exercises];const ti=idx+dir;
        if(ti<0||ti>=exs.length)return;[exs[idx],exs[ti]]=[exs[ti],exs[idx]];
        saveW(workouts.map(s=>s.section===secName?{...s,exercises:exs}:s));
      };
      const renameSection=(old,nw)=>{saveW(workouts.map(s=>s.section===old?{...s,section:nw}:s));if(activeSection===old)setActiveSection(nw);};
      const deleteSection=secName=>{
        if(!confirm(`Delete "${secName}"?`))return;
        saveW(workouts.filter(s=>s.section!==secName));if(activeSection===secName)setActiveSection(null);
      };
      const addSection=()=>{const nm=prompt("New section name:");if(!nm)return;saveW([...workouts,{section:nm,exercises:[]}]);};
      const moveExTo=(fromSec,exId,toSec)=>{
        const ex=workouts.find(s=>s.section===fromSec)?.exercises.find(e=>(e.id||e.name)===exId);if(!ex)return;
        saveW(workouts.map(s=>{if(s.section===fromSec)return{...s,exercises:s.exercises.filter(e=>(e.id||e.name)!==exId)};if(s.section===toSec)return{...s,exercises:[...s.exercises,ex]};return s;}));
      };
      const updateExercise=(secName,idx,patch)=>saveW(workouts.map(s=>s.section===secName?{...s,exercises:s.exercises.map((e,i)=>i===idx?{...e,...patch}:e)}:s));
      const deleteExercise=(secName,exId)=>saveW(workouts.map(s=>s.section===secName?{...s,exercises:s.exercises.filter(e=>(e.id||e.name)!==exId)}:s));
      const handleAddExercise=secName=>{
        const nm=prompt("New exercise name:");if(!nm)return;
        saveW(workouts.map(s=>s.section===secName?{...s,exercises:[...s.exercises,{id:uid(),name:nm,equip:"Bodyweight",sets:1,reps:"5-8",rest:"90s",weight:"",cue:""}]}:s));
      };
      const launchSectionSession=sec=>{
        setActiveRoutine({name:`${sec.section} Workout`,color:tileColor,exercises:sec.exercises.map(e=>withSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
      };

      const logCheckedExercises = () => {
        const selectedIds = Object.keys(checkedExercises).filter(id => checkedExercises[id]);
        if (selectedIds.length === 0) return;
        const today = todayStr();
        const progression = store.get("workout_progression", []);
        selectedIds.forEach(id => {
          let foundEx = null;
          for (const sec of workoutSections) {
            const match = sec.exercises.find(e => (e.id||e.name) === id);
            if (match) { foundEx = match; break; }
          }
          const weightVal = weights[id] || (foundEx?.weight || "0");
          const repsVal = customReps[id] || (foundEx?.reps || "10");
          progression.push({ id: uid(), date: today, exercise: foundEx?.name || id, exerciseId: id, weight: weightVal, reps: repsVal, hold: "0" });
        });
        store.set("workout_progression", progression);
        const sessionLogs = store.get("workout_logs", []);
        sessionLogs.push({ id: uid(), date: today, routine: "Manual Log", total: selectedIds.length, completed: selectedIds.length, isPartial: false });
        store.set("workout_logs", sessionLogs);
        const c = store.get("workout_completed_counts", {workouts:0,tendons:0,stretches:0}); c.workouts += 1; store.set("workout_completed_counts", c);
        setCheckedExercises({}); alert(`Logged ${selectedIds.length} exercises!`); if (reloadLogs) reloadLogs();
      };

      const checkedCount = Object.keys(checkedExercises).filter(id => checkedExercises[id]).length;
      const accent = tileColor || "var(--accent)";
      const successColor = tileColor || (theme === 'anti-red' ? 'var(--accent)' : 'var(--success)');
      // Renameable tab heading and Full Body workout name
      const [heading,setHeading]=useState(()=>store.get("workouts_heading","Strength & Hypertrophy"));
      const saveHeading=t=>{const v=(t||"").trim()||"Strength & Hypertrophy";setHeading(v);store.set("workouts_heading",v);};
      const [fbName,setFbName]=useState(()=>store.get("workouts_fullbody_name","Full Body"));
      const saveFbName=t=>{const v=(t||"").trim()||"Full Body";setFbName(v);store.set("workouts_fullbody_name",v);};
      const [libFor,setLibFor]=useState(null);
      const [libPicked,setLibPicked]=useState({});
      const [libQuery,setLibQuery]=useState("");
      const closeLib=()=>{setLibFor(null);setLibPicked({});setLibQuery("");};

      return (
        <div style={accentVars(tileColor)}>
          {historyModal && <ExerciseHistoryModal exerciseId={historyModal.id} exerciseName={historyModal.name} onClose={() => setHistoryModal(null)}/>}
          {libFor&&(
            <TapModal isOpen onClose={closeLib}>
              <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>Add to {libFor}</h2>
              <p className="text-small" style={{marginBottom:"12px"}}>Browse by body part or search — cues come included.</p>
              <ExercisePickList sections={workoutSections} picked={libPicked} setPicked={setLibPicked} query={libQuery} setQuery={setLibQuery}/>
              <button className="button-primary" style={{marginTop:"14px"}} disabled={!Object.keys(libPicked).length} onClick={()=>{
                saveW(workouts.map(s=>s.section===libFor?{...s,exercises:[...s.exercises,...pickedToExercises(libPicked)]}:s));
                closeLib();
              }}>Add {Object.keys(libPicked).length||""} exercise{Object.keys(libPicked).length===1?"":"s"}</button>
              <button className="button-secondary" style={{marginTop:"10px"}} onClick={closeLib}>Cancel</button>
            </TapModal>
          )}
          <div className="card" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><h2 className="font-bold" style={{fontSize:"20px"}}><Editable value={heading} onSave={saveHeading}/></h2><p className="text-small">Progressive overload tracking</p></div>
            <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
              <button className="button-secondary" style={{width:"auto",padding:"8px 12px",fontSize:"12px",borderColor:editMode?"var(--accent)":"var(--card-border)",color:editMode?"var(--accent)":"var(--text)"}} onClick={()=>{
                if(editMode){
                  let u=[...workouts];
                  Object.entries(draftNames).forEach(([oldName,draft])=>{
                    const trimmed=draft.trim();
                    if(trimmed&&trimmed!==oldName){u=u.map(s=>s.section===oldName?{...s,section:trimmed}:s);if(activeSection===oldName)setActiveSection(trimmed);}
                  });
                  setWorkouts(u);store.set("workout_sections_custom",u);setDraftNames({});setEditMode(false);
                }else{setDraftNames({});setEditMode(true);}
              }}>{editMode?"Done":"Edit"}</button>
              <span className="badge" style={{background:theme==='anti-red'?`var(--accent-muted)`:`var(--success-muted)`,color:successColor,borderColor:successColor}}>{counts.workouts} Done</span>
            </div>
          </div>
          <div className="card" style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderColor:accent,borderWidth:"1.5px"}}>
            <div>
              <p className="font-bold" style={{fontSize:"16px"}}><Editable value={fbName} onSave={saveFbName}/></p>
              <p className="text-small">{(workoutSections.find(s=>s.section==="Full Body")||{exercises:[]}).exercises.length} exercises — edit in the Full Body section below</p>
            </div>
            <button className="button-primary" style={{width:"auto",padding:"10px 20px",fontSize:"14px",background:accent,borderColor:accent}}
              onClick={()=>{const fb=workoutSections.find(s=>s.section==="Full Body");const list=fb?fb.exercises:workoutSections.flatMap(s=>s.exercises);setActiveRoutine({name:`${fbName} Workout`,color:tileColor,exercises:list.map(e=>withSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});}}>
              Start
            </button>
          </div>
          {workoutSections.map((sec,si)=>{
            const isOpen=activeSection===sec.section;
            const otherSecs=workoutSections.filter(s=>s.section!==sec.section).map(s=>s.section);
            return (
              <div key={sec.section} className="card" style={{padding:"12px 16px"}}>
                <div className="flex-between" style={{cursor:editMode?"default":"pointer"}} onClick={()=>!editMode&&setActiveSection(isOpen?null:sec.section)}>
                  <div className="flex-row">
                    {editMode?<input className="field" style={{marginBottom:0,fontWeight:"700",fontSize:"16px",padding:"6px 10px",width:"160px"}} value={draftNames[sec.section]!==undefined?draftNames[sec.section]:sec.section} onClick={e=>e.stopPropagation()} onChange={e=>setDraftNames(p=>({...p,[sec.section]:e.target.value}))}/>:<Editable as="p" className="font-bold" style={{fontSize:"17px"}} value={sec.section} onSave={t=>renameSection(sec.section,t)} singleAction={()=>setActiveSection(isOpen?null:sec.section)}/>}
                    <span className="exercise-count-badge">{sec.exercises.length}</span>
                  </div>
                  {editMode?<button onClick={e=>{e.stopPropagation();deleteSection(sec.section);}} style={{padding:"4px 10px",borderRadius:"8px",background:"var(--danger-muted)",color:"var(--danger)",fontSize:"12px",fontWeight:"700"}}>Delete</button>:<span style={{fontSize:"18px",transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"none"}}>→</span>}
                </div>
                {(isOpen||editMode)&&(
                  <div style={{marginTop:"16px",borderTop:"1px solid var(--card-border)",paddingTop:"12px"}}>
                    {!editMode&&<button className="button-primary" style={{marginBottom:"16px",padding:"10px 14px",fontSize:"14px",background:accent,borderColor:accent}} onClick={()=>launchSectionSession(sec)}>Start Session</button>}
                    {sec.exercises.map((ex,ei)=>{
                      const exKey = ex.id || ex.name;
                      const suggestion = getProgressionSuggestion(exKey, ex.name, ex.reps);
                      return (
                      <div key={exKey} className="flex-between" style={{padding:"10px 0",borderBottom:ei+1<sec.exercises.length?"0.5px solid var(--card-border)":"none",gap:"8px",alignItems:"flex-start"}}>
                        {!editMode&&<button className={`custom-tick ${checkedExercises[exKey]?"checked":""}`} onClick={()=>setCheckedExercises(prev=>({...prev,[exKey]:!prev[exKey]}))} style={{marginTop:"4px"}}>  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--btn-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></button>}
                        {editMode?(
                          <div style={{flex:1,display:"flex",gap:"6px",alignItems:"flex-start"}}>
                            <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                              <button onClick={()=>moveExercise(sec.section,ei,-1)} disabled={ei===0} style={{opacity:ei===0?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▲</button>
                              <button onClick={()=>moveExercise(sec.section,ei,1)} disabled={ei===sec.exercises.length-1} style={{opacity:ei===sec.exercises.length-1?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▼</button>
                            </div>
                            <div style={{flex:1,display:"flex",flexDirection:"column",gap:"5px"}}>
                              <div style={{display:"grid",gridTemplateColumns:"1fr 44px 60px",gap:"5px",alignItems:"center"}}>
                                <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} value={ex.name} onChange={e=>updateExercise(sec.section,ei,{name:e.target.value})}/>
                                <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} type="number" min="1" value={ex.sets} onChange={e=>updateExercise(sec.section,ei,{sets:parseInt(e.target.value)||1})}/>
                                <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} value={ex.reps||""} onChange={e=>updateExercise(sec.section,ei,{reps:e.target.value})}/>
                              </div>
                              <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                                <span className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"700"}}>Rest</span>
                                <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px",width:"72px"}} value={ex.rest||""} placeholder="90s" onChange={e=>updateExercise(sec.section,ei,{rest:e.target.value})}/>
                                <SideToggle ex={ex} onChange={v=>updateExercise(sec.section,ei,{unilateral:v})}/>
                                {ei<sec.exercises.length-1&&<button onClick={()=>updateExercise(sec.section,ei,{supersetWithNext:!ex.supersetWithNext})} title="Superset with the next exercise"
                                  style={{padding:"6px 9px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",flexShrink:0,
                                    border:`1.5px solid ${ex.supersetWithNext?"var(--accent)":"var(--card-border)"}`,
                                    color:ex.supersetWithNext?"var(--accent)":"var(--text-secondary)",
                                    background:ex.supersetWithNext?"var(--accent-muted)":"var(--input-bg)",display:"inline-flex",alignItems:"center",gap:"4px"}}><Icons.Link/>SS</button>}
                                {otherSecs.length>0&&<select className="field" style={{marginBottom:0,fontSize:"11px",padding:"5px",width:"68px",cursor:"pointer"}} value="" onChange={e=>{if(e.target.value)moveExTo(sec.section,exKey,e.target.value);}}>
                                  <option value="">Move→</option>
                                  {otherSecs.map(s=><option key={s} value={s}>{s}</option>)}
                                </select>}
                              </div>
                            </div>
                            <button onClick={()=>deleteExercise(sec.section,exKey)} style={{width:"30px",height:"30px",flexShrink:0,borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",fontSize:"16px",fontWeight:"900"}}>×</button>
                          </div>
                        ):(
                          <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:"8px",minWidth:0}}>
                            <div style={{flex:1,minWidth:0}}>
                              <Editable as="p" className="font-bold" style={{fontSize:"14px"}} value={ex.name} onSave={t=>updateExercise(sec.section,ei,{name:t})} singleAction={()=>setHistoryModal({id:exKey,name:ex.name})}/>
                              <p className="text-small" style={{fontSize:"11px",marginTop:"2px"}}>{ex.equip} — {ex.sets} sets
                                {exerciseHasSides(ex)&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>L+R</span>}
                                {ex.supersetWithNext&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>SS</span>}
                                <span className="badge" style={{fontSize:"9px",marginLeft:"4px",opacity:0.75}}>{muscleGroupOf(ex.name)}</span>
                              </p>
                              <PreviousPerformanceBanner exerciseId={exKey} exerciseName={ex.name} compact/>
                              {suggestion && <span className={`suggestion-badge ${suggestion.type}`}>{suggestion.msg}</span>}
                              <Editable as="p" multiline className="text-small" style={{fontSize:"12px",marginTop:"4px",fontStyle:"italic",opacity:0.85,lineHeight:"1.35"}} value={ex.cue||""} placeholder="Double-tap to add cue…" onSave={t=>updateExercise(sec.section,ei,{cue:t})}/>
                            </div>
                            <div style={{display:"flex",gap:"4px",alignItems:"center",flexShrink:0,marginTop:"2px"}}>
                              <ExerciseNoteButton exerciseId={exKey} notes={notes} onSave={saveNote}/>
                              <WeightChip exKey={exKey} defaultWeight={ex.weight} color="var(--accent)" weights={weights} onSave={saveWeight}/>
                              <RepsChip exKey={exKey} defaultReps={ex.reps} color="var(--accent)" reps={customReps} onSave={saveReps}/>
                            </div>
                          </div>
                        )}
                      </div>
                    );})}
                    {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"12px",flexWrap:"wrap"}}>
                      <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>setLibFor(sec.section)}>+ Add Exercise</button>
                      <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>handleAddExercise(sec.section)}>+ Blank</button>
                      <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>{
                        const v=prompt(`Rest time for ALL exercises in "${sec.section}" (e.g. 90s or 2 min):`);
                        if(!v)return;
                        saveW(workouts.map(s=>s.section===sec.section?{...s,exercises:s.exercises.map(e=>({...e,rest:v.trim()}))}:s));
                      }}><Icons.Clock/> Rest for all</button>
                    </div>}
                  </div>
                )}
              </div>
            );
          })}
          {editMode&&<button className="button-secondary" style={{padding:"12px",marginBottom:"16px",fontSize:"14px"}} onClick={addSection}>+ Add Section</button>}
          {checkedCount > 0 && (
            <div className="card log-sticky">
              <div className="flex-between"><p className="font-bold">Log Checked Exercises</p><span className="badge">{checkedCount} selected</span></div>
              <button className="button-primary" onClick={logCheckedExercises}>Log Selected ({checkedCount}) to History</button>
            </div>
          )}
        </div>
      );
    }

    // ── TendonsTab ─────────────────────────────────────────────────────────────
    function TendonsTab({weights,saveWeight,counts,setActiveRoutine,theme,reloadLogs,notes,saveNote,tileColor}) {
      const [selectedPhase,setSelectedPhase]=useState("explosive");
      const [editMode,setEditMode]=useState(false);
      const [checked,setChecked]=useState({});
      const [historyModal,setHistoryModal]=useState(null);
      const [tendonData,setTendonData]=useState(()=>{
        // v2 plan: new key so existing users get the Explosive plan, not the old phases.
        const saved=store.get("tendon_custom_v3",null);
        if(saved&&saved.explosive)return saved;
        return TENDON;
      });
      const pd=tendonData[selectedPhase];
      const pdColor=tileColor||getThemeColor(pd.color,theme);
      const [libFor,setLibFor]=useState(null);
      const [libPicked,setLibPicked]=useState({});
      const [libQuery,setLibQuery]=useState("");
      const closeLib=()=>{setLibFor(null);setLibPicked({});setLibQuery("");};
      const saveTendon=u=>{setTendonData(u);store.set("tendon_custom_v3",u);};
      const updatePhaseField=(field,value)=>saveTendon({...tendonData,[selectedPhase]:{...pd,[field]:value}});
      const updateSession=(sessLabel,patch)=>saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sessLabel?{...s,...patch}:s)}});
      const updateEx=(sessLabel,idx,patch)=>saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sessLabel?{...s,exercises:s.exercises.map((e,i)=>i===idx?{...e,...patch}:e)}:s)}});
      const deleteEx=(sessLabel,exId)=>saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sessLabel?{...s,exercises:s.exercises.filter(e=>(e.id||e.name)!==exId)}:s)}});
      const moveEx=(sessLabel,idx,dir)=>{
        const sess=pd.sessions.find(s=>s.label===sessLabel);if(!sess)return;
        const exs=[...sess.exercises];const ti=idx+dir;
        if(ti<0||ti>=exs.length)return;
        [exs[idx],exs[ti]]=[exs[ti],exs[idx]];
        saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sessLabel?{...s,exercises:exs}:s)}});
      };
      const addEx=sessLabel=>{
        const nm=prompt("New exercise name:");if(!nm)return;
        const ex={id:uid(),name:nm,equip:"Single leg",sets:1,reps:"6",hold:"30s",weight:"",rest:"90s",cue:"",single:true};
        saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sessLabel?{...s,exercises:[...s.exercises,ex]}:s)}});
      };
      const launch=sess=>{
        setActiveRoutine({name:`Tendon - ${pd.label} (${sess.label})`,color:pdColor,exercises:sess.exercises.map(e=>withTendonSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
      };
      const logChecked=()=>{
        const ids=Object.keys(checked).filter(id=>checked[id]);if(!ids.length)return;
        const today=todayStr();const prog=store.get("workout_progression",[]);
        ids.forEach(id=>{
          let ex=null;for(const s of pd.sessions){ex=s.exercises.find(e=>(e.id||e.name)===id);if(ex)break;}
          prog.push({id:uid(),date:today,exercise:ex?.name||id,exerciseId:id,weight:weights[id]||ex?.weight||"0",reps:ex?.reps||"",hold:ex?.hold||"0"});
        });
        store.set("workout_progression",prog);
        const logs=store.get("workout_logs",[]);logs.push({id:uid(),date:today,routine:`Tendon ${pd.label}`,total:ids.length,completed:ids.length,isPartial:false});
        store.set("workout_logs",logs);
        const cnt=store.get("workout_completed_counts",{workouts:0,tendons:0,stretches:0});cnt.tendons+=1;store.set("workout_completed_counts",cnt);
        setChecked({});if(reloadLogs)reloadLogs();alert(`Logged ${ids.length} exercise${ids.length>1?"s":""}!`);
      };
      const checkedCount=Object.values(checked).filter(Boolean).length;
      return (
        <div style={accentVars(tileColor)}>
          {historyModal && <ExerciseHistoryModal exerciseId={historyModal.id} exerciseName={historyModal.name} onClose={() => setHistoryModal(null)}/>}
          {libFor&&(
            <TapModal isOpen onClose={closeLib}>
              <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>Add to {libFor}</h2>
              <p className="text-small" style={{marginBottom:"12px"}}>Picked exercises convert to timed holds — adjust in edit mode.</p>
              <ExercisePickList db={TENDON_DB} allowCreate={false} picked={libPicked} setPicked={setLibPicked} query={libQuery} setQuery={setLibQuery}/>
              <button className="button-primary" style={{marginTop:"14px"}} disabled={!Object.keys(libPicked).length} onClick={()=>{
                const added=pickedToExercises(libPicked,"tendon").map(e=>({...e,hold:e.hold||"30s",reps:e.reps||"",sets:e.sets||3,rest:e.rest||"90s"}));
                saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===libFor?{...s,exercises:[...s.exercises,...added]}:s)}});
                closeLib();
              }}>Add {Object.keys(libPicked).length||""}</button>
              <button className="button-secondary" style={{marginTop:"10px"}} onClick={closeLib}>Cancel</button>
            </TapModal>
          )}
          {Object.keys(tendonData).length>1&&<div className="card" style={{padding:"8px",display:"flex",gap:"6px",marginBottom:"14px"}}>
            {Object.keys(tendonData).map(k=>{
              const btnColor=tileColor||getThemeColor(tendonData[k].color,theme);
              return <button key={k} onClick={()=>setSelectedPhase(k)} style={{flex:1,padding:"10px",borderRadius:"10px",background:selectedPhase===k?btnColor:"transparent",color:selectedPhase===k?"var(--btn-text)":"var(--text-secondary)",fontWeight:"700",fontSize:"13px"}}>{tendonData[k].label}</button>;
            })}
          </div>}
          <div className="card">
            <div className="flex-between">
              <div style={{flex:1}}>
                {editMode?<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginRight:"8px"}}>
                  <input className="field" style={{marginBottom:0}} value={pd.name} onChange={e=>updatePhaseField("name",e.target.value)}/>
                  <input className="field" style={{marginBottom:0}} value={pd.weeks} onChange={e=>updatePhaseField("weeks",e.target.value)}/>
                </div>:<><Editable as="h2" className="font-bold" style={{fontSize:"20px",color:pdColor}} value={pd.name} onSave={t=>updatePhaseField("name",t)}/><Editable as="p" className="text-small" value={pd.weeks} onSave={t=>updatePhaseField("weeks",t)}/></>}
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <button className="button-secondary" style={{width:"auto",padding:"8px 12px",fontSize:"12px",borderColor:editMode?pdColor:"var(--card-border)",color:editMode?pdColor:"var(--text)"}} onClick={()=>setEditMode(e=>!e)}>{editMode?"Done":"Edit"}</button>
                <span className="badge" style={{background:theme==="anti-red"?"var(--accent-muted)":`${pdColor}20`,color:pdColor,borderColor:pdColor}}>{counts.tendons} Done</span>
              </div>
            </div>
            <Editable as="p" multiline className="exercise-cue-box" style={{borderLeftColor:pdColor,marginTop:"14px"}} value={pd.meta} onSave={t=>updatePhaseField("meta",t)}/>
            {editMode&&<ColorPalette value={pd.color} onPick={c=>updatePhaseField("color",c)}/>}
          </div>
          {pd.sessions.map((sess,i)=>(
            <div key={i} className="card">
              <div className="flex-between" style={{marginBottom:"12px"}}>
                <div style={{flex:1,marginRight:"8px"}}>
                  <Editable as="h3" className="font-bold" style={{fontSize:"17px"}} value={sess.label} onSave={t=>updateSession(sess.label,{label:t})}/>
                  <Editable as="p" className="text-small" value={sess.day} placeholder="Add focus…" onSave={t=>updateSession(sess.label,{day:t})}/>
                </div>
                <button className="button-primary" style={{width:"auto",padding:"8px 16px",fontSize:"13px",background:pdColor,borderColor:pdColor}} onClick={()=>launch(sess)}>Start</button>
              </div>
              <div style={{borderTop:"1.5px solid var(--card-border)",paddingTop:"8px"}}>
                {sess.exercises.map((ex,ei)=>{
                  const exKey = ex.id || ex.name;
                  return (
                  <><div key={exKey} className="flex-between" style={{ padding: "8px 0", borderBottom: ei + 1 < sess.exercises.length ? "0.5px solid var(--card-border)" : "none", gap: "8px", alignItems: "flex-start" }}>
                      {editMode ? (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0 }}>
                            <button onClick={() => moveEx(sess.label, ei, -1)} disabled={ei === 0} style={{ opacity: ei === 0 ? 0.3 : 1, padding: "1px 5px", fontSize: "11px" }}>▲</button>
                            <button onClick={() => moveEx(sess.label, ei, 1)} disabled={ei === sess.exercises.length - 1} style={{ opacity: ei === sess.exercises.length - 1 ? 0.3 : 1, padding: "1px 5px", fontSize: "11px" }}>▼</button>
                          </div>
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "5px" }}>
                            <>
                              <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px" }} value={ex.name} onChange={e => updateEx(sess.label, ei, { name: e.target.value })} />
                                <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px" }} type="number" min="1" value={ex.sets} onChange={e => updateEx(sess.label, ei, { sets: parseInt(e.target.value) || 1 })} />
                              </div>
                              {ex.metric === 'distance' ? (
                                <>
                                  <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                    <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="dist" value={ex.dist || ""} />]} onChange={e => updateEx(sess.label, ei, { dist: e.target.value })}/>
                                    <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="effort" value={ex.effort || ""} />]} onChange={e => updateEx(sess.label, ei, { effort: e.target.value })}/>
                                  </div>
                                </>
                              ) : (
                                <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                  <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px" }} value={ex.hold || ex.reps || ""} />]} onChange={e => updateEx(sess.label, ei, { hold: e.target.value, reps: e.target.value })}/>
                                </div>
                              )}
                            </>
                            {ex.metric === 'distance' ? (
                              <>
                                <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                  <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="dist" value={ex.dist || ""} />]} onChange={e => updateEx(sess.label, ei, { dist: e.target.value })}/>
                                  <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="effort" value={ex.effort || ""} />]} onChange={e => updateEx(sess.label, ei, { effort: e.target.value })}/>
                                </div>
                              </>
                            ) : (
                              <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px" }} value={ex.hold || ex.reps || ""} />]} onChange={e => updateEx(sess.label, ei, { hold: e.target.value, reps: e.target.value })}/>
                              </div>
                            )}
                          </div>
                          {ex.metric === 'distance' ? (
                            <>
                              <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                                <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="dist" value={ex.dist || ""} />]} onChange={e => updateEx(sess.label, ei, { dist: e.target.value })}/>
                                <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "100px" }} placeholder="effort" value={ex.effort || ""} />]} onChange={e => updateEx(sess.label, ei, { effort: e.target.value })}/>
                              </div>
                            </>
                          ) : (
                            <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                              <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px" }} value={ex.hold || ex.reps || ""} />]} onChange={e => updateEx(sess.label, ei, { hold: e.target.value, reps: e.target.value })}/>
                            </div>
                          )}
                        </>) : }div>
                      <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                        <span className="text-small" style={{ fontSize: "10px", textTransform: "uppercase", fontWeight: "700" }}>Rest</span>
                        <input className="field" style={{ marginBottom: 0, fontSize: "13px", padding: "6px", width: "72px" }} value={ex.rest || ""} placeholder="90s" onChange={e => updateEx(sess.label, ei, { rest: e.target.value })} />
                        <SideToggle ex={ex} detector={withTendonSides} onChange={v => updateEx(sess.label, ei, { unilateral: v })} />
                        {ei < sess.exercises.length - 1 && <button onClick={() => updateEx(sess.label, ei, { supersetWithNext: !ex.supersetWithNext })} title="Superset with the next exercise"
                          style={{
                            padding: "6px 9px", borderRadius: "8px", fontSize: "11px", fontWeight: "800", flexShrink: 0,
                            border: `1.5px solid ${ex.supersetWithNext ? "var(--accent)" : "var(--card-border)"}`,
                            color: ex.supersetWithNext ? "var(--accent)" : "var(--text-secondary)",
                            background: ex.supersetWithNext ? "var(--accent-muted)" : "var(--input-bg)", display: "inline-flex", alignItems: "center", gap: "4px"
                          }}><Icons.Link />SS</button>}
                      </div>
                    </div><button onClick={() => deleteEx(sess.label, exKey)} style={{ width: "30px", height: "30px", flexShrink: 0, borderRadius: "50%", background: "var(--danger-muted)", color: "var(--danger)", fontSize: "16px", fontWeight: "900" }}>×</button></>
                      </>
                    ):(
                      <>
                        <button className={`custom-tick ${checked[exKey]?"checked":""}`} onClick={()=>setChecked(p=>({...p,[exKey]:!p[exKey]}))} style={{marginTop:"4px"}}>  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--btn-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></button>
                        <div style={{flex:1,minWidth:0}}>
                          <Editable as="p" className="font-bold" style={{fontSize:"14px"}} value={ex.name} onSave={t=>updateEx(sess.label,ei,{name:t})} singleAction={()=>setHistoryModal({id:exKey,name:ex.name})}/>
                          <p className="text-small" style={{fontSize:"11px"}}>{ex.equip} — {ex.sets} sets — {ex.metric==='distance'?`${ex.dist||'distance'}${ex.effort?` @ ${ex.effort}`:''}`:(ex.hold?`Hold ${ex.hold}`:(ex.reps?`${ex.reps} reps`:''))}
                            {tendonExHasSides(ex)&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>L+R</span>}
                          </p>
                          <PreviousPerformanceBanner exerciseId={exKey} exerciseName={ex.name} compact/>
                          <Editable as="p" multiline className="text-small" style={{fontSize:"12px",marginTop:"4px",fontStyle:"italic",opacity:0.85,lineHeight:"1.35"}} value={ex.cue||""} placeholder="Double-tap to add cue…" onSave={t=>updateEx(sess.label,ei,{cue:t})}/>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"4px",alignItems:"center",flexShrink:0}}>
                          <ExerciseNoteButton exerciseId={exKey} notes={notes} onSave={saveNote}/>
                          {ex.metric==='distance'?
                            <span className="badge" style={{fontSize:"10px"}}>{ex.dist||'dist'}</span>
                            :<WeightChip exKey={exKey} defaultWeight={ex.weight} color={pdColor} weights={weights} onSave={saveWeight}/>}
                        </div>
                      </>
                    )}
                  </div>
                );})}
                {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"10px",flexWrap:"wrap"}}>
                  <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>setLibFor(sess.label)}>+ Add Exercise</button>
                  <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>addEx(sess.label)}>+ Blank</button>
                  <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>{
                    const v=prompt(`Rest time for ALL exercises in "${sess.label}" (e.g. 90s or 2 min):`);
                    if(!v)return;
                    saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sess.label?{...s,exercises:s.exercises.map(e=>({...e,rest:v.trim()}))}:s)}});
                  }}><Icons.Clock/> Rest for all</button>
                </div>}
              </div>
            </div>
          ))}
          {checkedCount>0&&(
            <div className="card log-sticky">
              <div className="flex-between"><p className="font-bold">Log Checked</p><span className="badge">{checkedCount} selected</span></div>
              <button className="button-primary" onClick={logChecked}>Log Selected ({checkedCount})</button>
            </div>
          )}
        </div>
      );
    }

    // ── StretchesTab ───────────────────────────────────────────────────────────
    function StretchesTab({counts,setActiveRoutine,theme,reloadLogs,tileColor}) {
      const [checked,setChecked]=useState({});
      const [stretchOrder,setStretchOrder]=useState(()=>store.get("stretch_order",{}));
      const [selectedPhase,setSelectedPhase]=useState(1);
      const [editMode,setEditMode]=useState(false);
      const [customStretches,setCustomStretches]=useState(()=>store.get("stretch_custom",{}));
      const [hiddenStretches,setHiddenStretches]=useState(()=>store.get("stretch_hidden",{}));
      const [phaseEdits,setPhaseEdits]=useState(()=>store.get("stretch_phase_edits",{}));
      const phaseData=SPHASE[selectedPhase];
      const displayPhase={...phaseData,...(phaseEdits[selectedPhase]||{})};
      const phaseColor = tileColor||getThemeColor(displayPhase.color,theme);
      const baseList=getPhaseStretches(selectedPhase).filter(s=>!(hiddenStretches[selectedPhase]||[]).includes(s.name));
      const rawList=[...baseList,...(customStretches[selectedPhase]||[])];
      const saveOrder=u=>{setStretchOrder(u);store.set("stretch_order",u);};
      const _ord=stretchOrder[selectedPhase];
      const stretchList=_ord?_ord.map(n=>rawList.find(s=>s.name===n)).filter(Boolean).concat(rawList.filter(s=>!_ord.includes(s.name))):rawList;
      const moveStretch=(name,dir)=>{
        const names=stretchList.map(s=>s.name);const idx=names.indexOf(name);const ni=idx+dir;
        if(ni<0||ni>=names.length)return;const arr=[...names];[arr[idx],arr[ni]]=[arr[ni],arr[idx]];
        saveOrder({...stretchOrder,[selectedPhase]:arr});
      };
      const saveCustom=u=>{setCustomStretches(u);store.set("stretch_custom",u);};
      const saveHidden=u=>{setHiddenStretches(u);store.set("stretch_hidden",u);};
      const savePhaseEdit=patch=>{const u={...phaseEdits,[selectedPhase]:{...(phaseEdits[selectedPhase]||{}),...patch}};setPhaseEdits(u);store.set("stretch_phase_edits",u);};
      const updateStretch=(idx,patch)=>{
        const baseLen=baseList.length;
        if(idx<baseLen){
          saveHidden({...hiddenStretches,[selectedPhase]:[...(hiddenStretches[selectedPhase]||[]),baseList[idx].name]});
          saveCustom({...customStretches,[selectedPhase]:[...(customStretches[selectedPhase]||[]),{...baseList[idx],...patch}]});
        }else{
          const ci=idx-baseLen;
          saveCustom({...customStretches,[selectedPhase]:(customStretches[selectedPhase]||[]).map((s,i)=>i===ci?{...s,...patch}:s)});
        }
      };
      const deleteStretch=name=>saveHidden({...hiddenStretches,[selectedPhase]:[...(hiddenStretches[selectedPhase]||[]),name]});
      const addStretch=()=>{
        const nm=prompt("New stretch name:");if(!nm)return;
        saveCustom({...customStretches,[selectedPhase]:[...(customStretches[selectedPhase]||[]),{id:uid(),name:nm,totalSec:60,sideLabels:[],muscles:["Custom"],phases:{[selectedPhase]:{dur:"60s",how:"Custom movement."}}}]});
      };
      const logChecked=()=>{
        const names=Object.keys(checked).filter(n=>checked[n]);if(!names.length)return;
        const today=todayStr();const logs=store.get("workout_logs",[]);
        logs.push({id:uid(),date:today,routine:`Stretching Phase ${selectedPhase}`,total:names.length,completed:names.length,isPartial:false});
        store.set("workout_logs",logs);
        const cnt=store.get("workout_completed_counts",{workouts:0,tendons:0,stretches:0});cnt.stretches+=1;store.set("workout_completed_counts",cnt);
        setChecked({});if(reloadLogs)reloadLogs();alert(`Logged ${names.length} stretch${names.length>1?"es":""}!`);
      };
      const [stretchRest,setStretchRest]=useState(()=>String(store.get("stretch_rest_sec",30)));
      const saveStretchRest=v=>{setStretchRest(v);const n=Math.max(0,Math.min(300,parseInt(v)||0));store.set("stretch_rest_sec",n);};
      const launchStretchSession=()=>{
        const rs=Math.max(0,parseInt(store.get("stretch_rest_sec",30))||0);
        setActiveRoutine({name:`Stretching Phase ${selectedPhase} - ${phaseData.name}`,color:phaseColor,exercises:stretchList.map(s=>withSides({...s,sets:1,hold:`${s.totalSec}s`,rest:rs>0?`${rs}s`:"0s",cue:getStretchCue(s,selectedPhase)}))});
      };
      return (
        <div style={accentVars(tileColor)}>
          <div className="card" style={{padding:"8px",display:"flex",gap:"4px",marginBottom:"14px",overflowX:"auto"}}>
            {Object.keys(SPHASE).map(k=>{
              const a=selectedPhase===parseInt(k);
              const btnColor = tileColor||getThemeColor(SPHASE[k].color,theme);
              return(<button key={k} onClick={()=>setSelectedPhase(parseInt(k))} style={{flex:"1 0 auto",padding:"8px 12px",borderRadius:"10px",background:a?btnColor:"transparent",color:a?"var(--btn-text)":"var(--text-secondary)",fontWeight:"700",fontSize:"12px"}}>{phaseEdits[k]?.name||`Phase ${k}`}</button>);
            })}
          </div>
          <div className="card">
            <div className="flex-between">
              <div style={{flex:1}}>
                {editMode?(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginRight:"8px"}}><input className="field" style={{marginBottom:0}} value={displayPhase.name} onChange={e=>savePhaseEdit({name:e.target.value})}/><input className="field" style={{marginBottom:0}} value={displayPhase.months} onChange={e=>savePhaseEdit({months:e.target.value})}/></div>):(<><Editable as="h2" className="font-bold" style={{fontSize:"20px",color:phaseColor}} value={displayPhase.name} onSave={t=>savePhaseEdit({name:t})}/><Editable as="p" className="text-small" value={displayPhase.months} onSave={t=>savePhaseEdit({months:t})}/></>)}
              </div>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <button className="button-secondary" style={{width:"auto",padding:"8px 12px",fontSize:"12px",borderColor:editMode?phaseColor:"var(--card-border)",color:editMode?phaseColor:"var(--text)"}} onClick={()=>setEditMode(e=>!e)}>{editMode?"Done":"Edit"}</button>
                <span className="badge" style={{background:theme==='anti-red'?'var(--accent-muted)':`${phaseColor}20`,color:phaseColor,borderColor:phaseColor}}>{counts.stretches} Done</span>
              </div>
            </div>
            <Editable as="p" multiline className="text-small" style={{marginTop:"8px"}} value={displayPhase.desc} placeholder="Add description…" onSave={t=>savePhaseEdit({desc:t})}/>
            {editMode&&<ColorPalette value={displayPhase.color} onPick={c=>savePhaseEdit({color:c})}/>}
            <div style={{display:"flex",alignItems:"center",gap:"10px",marginTop:"14px"}}>
              <span className="text-small" style={{fontSize:"11px",textTransform:"uppercase",fontWeight:"700"}}>Rest between stretches</span>
              <input className="field" type="number" min="0" max="300" style={{marginBottom:0,width:"72px",padding:"8px"}} value={stretchRest} onChange={e=>saveStretchRest(e.target.value)}/>
              <span className="text-small">sec</span>
            </div>
            <button className="button-primary" style={{marginTop:"12px",background:phaseColor,borderColor:phaseColor}} onClick={launchStretchSession}>Start — {fmtMin(getPhaseTotalSec(selectedPhase))}</button>
          </div>
          <div className="card" style={{padding:"12px 16px"}}>
            <h3 className="font-bold" style={{fontSize:"16px",marginBottom:"12px"}}>Exercises</h3>
            {stretchList.map((st,i)=>(
              <div key={(st.id||st.name)+i} style={{padding:"10px 0",borderBottom:i+1<stretchList.length?"0.5px solid var(--card-border)":"none"}}>
                <div className="flex-between" style={{gap:"8px",alignItems:"center"}}>
                  {editMode&&<div style={{display:"flex",flexDirection:"column",gap:"2px",flexShrink:0}}>
                    <button onClick={()=>moveStretch(st.name,-1)} disabled={i===0} style={{opacity:i===0?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▲</button>
                    <button onClick={()=>moveStretch(st.name,1)} disabled={i===stretchList.length-1} style={{opacity:i===stretchList.length-1?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▼</button>
                  </div>}
                  {!editMode&&<button className={`custom-tick ${checked[st.name]?"checked":""}`} onClick={()=>setChecked(p=>({...p,[st.name]:!p[st.name]}))}>  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--btn-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></button>}
                  {editMode?<div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 56px 52px",gap:"6px",alignItems:"center"}}>
                    <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"7px"}} value={st.name} onChange={e=>updateStretch(i,{name:e.target.value})}/>
                    <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"7px"}} type="number" min="10" value={st.totalSec} onChange={e=>updateStretch(i,{totalSec:parseInt(e.target.value)||60})}/>
                    <SideToggle ex={st} onChange={v=>updateStretch(i,{unilateral:v})}/>
                  </div>:<p className="font-bold" style={{flex:1}}><Editable value={st.name} onSave={t=>updateStretch(i,{name:t})}/>{st.isNew&&<span className="badge" style={{fontSize:"9px",marginLeft:"6px"}}>NEW</span>}</p>}
                  {editMode?<button onClick={()=>deleteStretch(st.name)} style={{width:"30px",height:"30px",flexShrink:0,borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",fontSize:"16px",fontWeight:"900"}}>×</button>:<span className="text-small font-bold" style={{color:phaseColor,flexShrink:0}}>{st.totalSec}s</span>}
                </div>
                {!editMode&&<Editable as="p" multiline className="text-small" style={{fontSize:"12px",marginTop:"4px",marginLeft:"28px",lineHeight:"1.4"}} value={getStretchCue(st,selectedPhase)} placeholder="Double-tap to add description…" onSave={t=>updateStretch(i,{phases:{...(st.phases||{}),[selectedPhase]:{...((st.phases||{})[selectedPhase]||{}),how:t}}})}/>}
              </div>
            ))}
            {editMode&&<button className="button-secondary" style={{marginTop:"12px",padding:"8px",fontSize:"13px"}} onClick={addStretch}>+ Add Movement</button>}
          </div>
          {Object.values(checked).some(Boolean)&&(
            <div className="card log-sticky">
              <div className="flex-between"><p className="font-bold">Log Checked Stretches</p><span className="badge">{Object.values(checked).filter(Boolean).length} selected</span></div>
              <button className="button-primary" onClick={logChecked}>Log Selected ({Object.values(checked).filter(Boolean).length})</button>
            </div>
          )}
        </div>
      );
    }

    // ── ProgressionTab ─────────────────────────────────────────────────────────
    function ProgressionTab({reloadLogs}) {
      const [trackedPts, setTrackedPts] = useState(() => store.get("workout_progression", []));
      const uniqueEx = [...new Set(trackedPts.map(p => p.exercise))];
      const [selectedEx, setSelectedEx] = useState(uniqueEx[0] || "");
      const [chartMode, setChartMode] = useState("weight");
      const filtered = trackedPts.filter(p => p.exercise === selectedEx);
      // ── Analytics (warm-up sets excluded) ──
      const working = trackedPts.filter(p => p.setType !== 'warmup');
      const dayMs = 86400000;
      const ageDays = p => Math.floor((Date.now() - new Date(p.date).getTime()) / dayMs);
      const tonnage = p => parseWeight(p.weight) * parseReps(p.reps);
      // Weekly sets per muscle group (last 7 days)
      const muscleSets = (() => {
        const m = {};
        working.filter(p => ageDays(p) < 7).forEach(p => { const g = muscleGroupOf(p.exercise); m[g] = (m[g] || 0) + 1; });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
      })();
      const maxMuscle = Math.max(1, ...muscleSets.map(([, v]) => v));
      // ── Muscle recovery: days since each group was last trained ──
      const recovery = (() => {
        const last = {};
        working.forEach(p => { const g = muscleGroupOf(p.exercise); const d = p.date; if (!last[g] || d > last[g]) last[g] = d; });
        return Object.entries(last).map(([g, d]) => ({group: g, days: Math.floor((Date.now() - new Date(d).getTime()) / dayMs)})).sort((a, b) => a.days - b.days);
      })();
      // ── Per-exercise records ──
      const exRecords = (() => {
        if (!selectedEx) return null;
        const pts = trackedPts.filter(p => p.exercise === selectedEx && p.setType !== 'warmup');
        if (!pts.length) return null;
        let bestW = pts[0], best1 = pts[0], bestVolDay = {};
        pts.forEach(p => {
          if (parseWeight(p.weight) > parseWeight(bestW.weight)) bestW = p;
          if (calc1RM(p.weight, p.reps) > calc1RM(best1.weight, best1.reps)) best1 = p;
          bestVolDay[p.date] = (bestVolDay[p.date] || 0) + parseWeight(p.weight) * parseReps(p.reps);
        });
        const topVol = Object.entries(bestVolDay).sort((a, b) => b[1] - a[1])[0];
        return {
          weight: parseWeight(bestW.weight) ? `${bestW.weight}${bestW.reps ? ` × ${bestW.reps}` : ''}` : null,
          oneRm: calc1RM(best1.weight, best1.reps) || null,
          sessionVol: topVol ? Math.round(topVol[1]).toLocaleString() : null,
        };
      })();
      // ── Achievements ──
      const allLogs = store.get("workout_logs", []);
      const streaksA = calculateStreaks();
      const totalVol = working.reduce((a, p) => a + tonnage(p), 0);
      const prCount = store.get("pr_history", []).length;
      const achievements = [
        {got: allLogs.length >= 1, label: "First session", sub: "Logged your first workout"},
        {got: allLogs.length >= 10, label: "10 sessions", sub: "Consistency building"},
        {got: allLogs.length >= 50, label: "50 sessions", sub: "Seasoned lifter"},
        {got: streaksA.longest >= 7, label: "7-day streak", sub: "A full week"},
        {got: streaksA.longest >= 30, label: "30-day streak", sub: "A full month"},
        {got: totalVol >= 100000, label: "100k kg moved", sub: "Lifetime volume"},
        {got: totalVol >= 500000, label: "500k kg moved", sub: "Serious tonnage"},
        {got: prCount >= 10, label: "10 PRs", sub: "Always improving"},
      ];
      const earned = achievements.filter(a => a.got);
      // ── CSV export ──
      const exportCSV = () => {
        const rows = [["date","exercise","weight","reps","hold","setNumber","setType","rir"]];
        trackedPts.forEach(p => rows.push([p.date, p.exercise, p.weight||"", p.reps||"", p.hold||"", p.setNumber||"", p.setType||"normal", p.rir!==undefined?p.rir:""]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], {type:"text/csv"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `workout-data-${todayStr()}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
      };
      // 8-week tonnage trend
      const weekVol = Array.from({length: 8}, (_, i) => {
        const lo = (7 - i) * 7, hi = lo + 7;
        return working.filter(p => { const a = ageDays(p); return a >= lo && a < hi; }).reduce((acc, p) => acc + tonnage(p), 0);
      });
      const maxWeek = Math.max(1, ...weekVol);
      // Training load: this week vs 4-week average
      const thisWeek = weekVol[7];
      const prevAvg = (weekVol[3] + weekVol[4] + weekVol[5] + weekVol[6]) / 4;
      const loadRatio = prevAvg > 0 ? thisWeek / prevAvg : null;
      const loadLabel = loadRatio === null ? null : loadRatio < 0.8 ? ["Light week", "var(--accent)"] : loadRatio <= 1.3 ? ["On track", "var(--success)"] : ["High load", "var(--warning)"];
      // Bodyweight log
      const [bwLog, setBwLog] = useState(() => store.get("body_weight_log", []));
      const [bwInput, setBwInput] = useState("");
      const addBw = () => {
        const v = parseFloat(bwInput);
        if (!v || v <= 0) return;
        const updated = [...bwLog.filter(e => e.date !== todayStr()), {date: todayStr(), kg: v}].sort((a, b) => new Date(a.date) - new Date(b.date));
        store.set("body_weight_log", updated); setBwLog(updated); setBwInput("");
      };
      const delBw = date => { const updated = bwLog.filter(e => e.date !== date); store.set("body_weight_log", updated); setBwLog(updated); };
      // Swipe-to-delete on history rows
      const swipeRef = useRef({x: 0, y: 0, id: null});
      const handleReset = () => {
        if (confirm("Delete all training history? This cannot be undone.")) {
          localStorage.removeItem("workout_progression"); localStorage.removeItem("workout_logs");
          localStorage.removeItem("workout_completed_counts"); reloadLogs(); setTrackedPts([]); setSelectedEx("");
        }
      };
      const handleDeleteSet = (id) => {
        if (confirm("Delete this recorded set?")) {
          const updated = trackedPts.filter(item => item.id !== id);
          store.set("workout_progression", updated); setTrackedPts(updated);
          const remainingEx = [...new Set(updated.map(p => p.exercise))];
          if (!remainingEx.length) setSelectedEx("");
          else if (!remainingEx.includes(selectedEx)) setSelectedEx(remainingEx[0]);
        }
      };
      return (
        <div>
          <div className="card">
            <div className="flex-between">
              <div><h2 className="font-bold" style={{fontSize:"20px"}}>Progression</h2><p className="text-small">Weight and hold tracking over time</p></div>
              {loadLabel && <span className="badge" style={{fontSize:"11px",padding:"6px 10px",color:loadLabel[1],borderColor:loadLabel[1]}} title="This week's volume vs your 4-week average">{loadLabel[0]}</span>}
            </div>
            {trackedPts.length>0 && <button className="button-secondary" style={{marginTop:"12px",padding:"9px",fontSize:"13px"}} onClick={exportCSV}><Icons.Download/> Export data as CSV</button>}
          </div>
          {muscleSets.length > 0 && (
            <div className="card">
              <h3 className="font-bold" style={{fontSize:"15px"}}>This Week — Sets per Muscle</h3>
              <p className="text-small" style={{marginBottom:"10px"}}>Working sets, last 7 days (warm-ups excluded)</p>
              {muscleSets.map(([g, v]) => (
                <div key={g} style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"6px"}}>
                  <span className="text-small" style={{width:"74px",fontWeight:"700",flexShrink:0}}>{g}</span>
                  <div style={{flex:1,height:"14px",borderRadius:"7px",background:"var(--input-bg)",overflow:"hidden"}}>
                    <div style={{width:`${Math.round(v/maxMuscle*100)}%`,height:"100%",borderRadius:"7px",background:"var(--accent)"}}/>
                  </div>
                  <span className="font-bold" style={{width:"26px",textAlign:"right",fontSize:"13px"}}>{v}</span>
                </div>
              ))}
            </div>
          )}
          {weekVol.some(v=>v>0) && (
            <div className="card">
              <h3 className="font-bold" style={{fontSize:"15px"}}>Weekly Volume — last 8 weeks</h3>
              <p className="text-small" style={{marginBottom:"10px"}}>Total tonnage (kg × reps)</p>
              <div style={{display:"flex",alignItems:"flex-end",gap:"6px",height:"90px"}}>
                {weekVol.map((v, i) => (
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"4px"}}>
                    <div style={{width:"100%",borderRadius:"6px 6px 0 0",background:i===7?"var(--accent)":"var(--accent-muted)",height:`${Math.max(3, Math.round(v/maxWeek*72))}px`}} title={`${Math.round(v).toLocaleString()} kg`}/>
                    <span className="text-small" style={{fontSize:"9px"}}>{i===7?"now":`-${7-i}w`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {recovery.length > 0 && (
            <div className="card">
              <h3 className="font-bold" style={{fontSize:"15px"}}>Muscle Recovery</h3>
              <p className="text-small" style={{marginBottom:"10px"}}>Days since each group was last trained</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:"8px"}}>
                {recovery.map(r => {
                  const fresh = r.days >= 3, mid = r.days === 2;
                  const col = fresh ? "var(--success)" : mid ? "var(--warning)" : "var(--text-secondary)";
                  return (
                    <div key={r.group} style={{flex:"1 1 28%",minWidth:"90px",border:`1px solid ${col}`,borderRadius:"12px",padding:"10px"}}>
                      <p className="font-bold" style={{fontSize:"13px"}}>{r.group}</p>
                      <p style={{fontSize:"20px",fontWeight:"900",color:col,lineHeight:"1.2"}}>{r.days===0?"Today":r.days===1?"1 day":`${r.days} days`}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {earned.length > 0 && (
            <div className="card">
              <h3 className="font-bold" style={{fontSize:"15px"}}>Achievements</h3>
              <p className="text-small" style={{marginBottom:"10px"}}>{earned.length} of {achievements.length} unlocked</p>
              <div style={{display:"flex",flexWrap:"wrap",gap:"8px"}}>
                {achievements.map((a,i)=>(
                  <div key={i} title={a.sub} style={{flex:"1 1 28%",minWidth:"100px",textAlign:"center",padding:"12px 8px",borderRadius:"12px",
                    border:`1px solid ${a.got?"var(--pr-gold)":"var(--card-border)"}`,opacity:a.got?1:0.4}}>
                    <div style={{color:a.got?"var(--pr-gold)":"var(--text-secondary)",display:"flex",justifyContent:"center",marginBottom:"4px"}}><Icons.Trophy size={18}/></div>
                    <p className="font-bold" style={{fontSize:"12px",lineHeight:"1.2"}}>{a.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <h3 className="font-bold" style={{fontSize:"15px"}}>Bodyweight</h3>
            <div style={{display:"flex",gap:"8px",margin:"10px 0"}}>
              <input className="field" inputMode="decimal" placeholder="kg today" style={{marginBottom:0,flex:1}} value={bwInput} onChange={e=>setBwInput(decOnly(e.target.value))}/>
              <button className="button-primary" style={{width:"auto",padding:"10px 16px",fontSize:"14px"}} onClick={addBw}>Log</button>
            </div>
            {bwLog.length>1&&(()=>{
              const vals=bwLog.map(e=>e.kg);const lo=Math.min(...vals),hi=Math.max(...vals),rng=(hi-lo)||1;
              return (
                <div style={{display:"flex",alignItems:"flex-end",gap:"3px",height:"56px",marginBottom:"8px"}}>
                  {bwLog.slice(-21).map(e=>(
                    <div key={e.date} style={{flex:1,borderRadius:"3px 3px 0 0",background:"var(--accent-muted)",borderTop:"2px solid var(--accent)",height:`${12+Math.round((e.kg-lo)/rng*40)}px`}} title={`${e.date}: ${e.kg}kg`}/>
                  ))}
                </div>
              );
            })()}
            {[...bwLog].reverse().slice(0,5).map(e=>(
              <div key={e.date} className="progression-item" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span className="text-small">{e.date}</span>
                <span style={{display:"flex",alignItems:"center",gap:"10px"}}>
                  <span className="font-bold text-accent">{e.kg} kg</span>
                  <button onClick={()=>delBw(e.date)} style={{color:"var(--danger)",background:"var(--danger-muted)",width:"20px",height:"20px",borderRadius:"50%",fontSize:"12px",fontWeight:"900"}}>×</button>
                </span>
              </div>
            ))}
          </div>
          {uniqueEx.length===0?(
            <div className="card">
              <div className="empty-state">
                <div className="es-icon"><Icons.Chart size={26}/></div>
                <p className="es-title">No data yet</p>
                <p className="es-sub">Complete a few sets in Workouts or Tendons and your progress charts, records and analytics will appear here.</p>
              </div>
            </div>
          ):(
            <div>
              <div className="card">
                <label className="field-label">Exercise</label>
                <select className="field" value={selectedEx} onChange={e=>setSelectedEx(e.target.value)} style={{background:"var(--input-bg)",cursor:"pointer"}}>
                  {uniqueEx.map((ue,i)=><option key={i} value={ue}>{ue}</option>)}
                </select>
                {exRecords && (exRecords.weight || exRecords.oneRm || exRecords.sessionVol) && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",marginTop:"14px"}}>
                    <div className="card summary-stat" style={{margin:0,borderColor:"var(--pr-gold)"}}><div className="stat-value" style={{color:"var(--pr-gold)",fontSize:"18px"}}>{exRecords.weight||"—"}</div><div className="stat-label">Best set</div></div>
                    <div className="card summary-stat" style={{margin:0,borderColor:"var(--pr-gold)"}}><div className="stat-value" style={{color:"var(--pr-gold)",fontSize:"22px"}}>{exRecords.oneRm?`${exRecords.oneRm}`:"—"}</div><div className="stat-label">Est 1RM</div></div>
                    <div className="card summary-stat" style={{margin:0,borderColor:"var(--pr-gold)"}}><div className="stat-value" style={{color:"var(--pr-gold)",fontSize:"18px"}}>{exRecords.sessionVol||"—"}</div><div className="stat-label">Best day vol</div></div>
                  </div>
                )}
                <div className="flex-between" style={{marginTop:"14px"}}>
                  <h3 className="font-bold" style={{fontSize:"15px"}}>Progression Curve</h3>
                  <div style={{display:"flex",gap:"4px"}}>
                    {[["weight","Weight"],["1rm","Est 1RM"]].map(([m,lab])=>(
                      <button key={m} onClick={()=>setChartMode(m)} style={{padding:"5px 10px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",
                        border:`1.5px solid ${chartMode===m?"var(--accent)":"var(--card-border)"}`,
                        color:chartMode===m?"var(--accent)":"var(--text-secondary)",
                        background:chartMode===m?"var(--accent-muted)":"transparent"}}>{lab}</button>
                    ))}
                  </div>
                </div>
                <ProgressionChart data={filtered} selectedExercise={selectedEx} mode={chartMode}/>
              </div>
              <div className="card">
                <h3 className="font-bold" style={{fontSize:"15px",marginBottom:"10px"}}>Log History</h3>
                {[...filtered].reverse().map((l,i)=>(
                  <div key={i} className="progression-item" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",touchAction:"pan-y"}}
                    onTouchStart={e=>{swipeRef.current={x:e.touches[0].clientX,y:e.touches[0].clientY,id:l.id};}}
                    onTouchEnd={e=>{
                      const s=swipeRef.current;
                      if(s.id!==l.id)return;
                      const dx=e.changedTouches[0].clientX-s.x, dy=e.changedTouches[0].clientY-s.y;
                      if(dx<-60&&Math.abs(dx)>Math.abs(dy)*2)handleDeleteSet(l.id);
                    }}>
                    <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center",gap:"6px"}}>
                      <span>{l.date}{l.setNumber ? ` (Set ${l.setNumber})` : ''}
                        {l.setType&&l.setType!=='normal'&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px",color:l.setType==='warmup'?"var(--warning)":l.setType==='failure'?"var(--danger)":"var(--accent)"}}>{l.setType==='warmup'?'W':l.setType==='drop'?'D':'F'}</span>}
                      </span>
                      <span className="font-bold text-accent">{l.weight||"BW"}{l.reps?` · ${l.reps} reps`:""}{l.hold&&l.hold!=="0"?` · ${l.hold}`:""}{l.rir!==undefined&&l.rir!==""?` · RIR ${l.rir}`:""}</span>
                    </div>
                    <button onClick={() => handleDeleteSet(l.id)} style={{color:"var(--danger)",background:"var(--danger-muted)",width:"22px",height:"22px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",fontWeight:"900",flexShrink:0}}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card" style={{border:"1px dashed var(--danger)"}}>
            <p className="font-bold text-danger">Danger Zone</p>
            <p className="text-small" style={{marginBottom:"12px"}}>Wipe all logged history and counters.</p>
            <button className="button-secondary" style={{color:"var(--danger)",border:"1.5px solid var(--danger)",background:"transparent"}} onClick={handleReset}>Reset All Tracking Data</button>
          </div>
        </div>
      );
    }

    function SplitBuilderModal({onSave,onClose,sections}) {
      const [step,setStep]=useState(0);
      const [kind,setKind]=useState(null);
      const [name,setName]=useState("");
      const [phaseCount,setPhaseCount]=useState("1");
      const [picked,setPicked]=useState({});
      const [query,setQuery]=useState("");
      const count=Object.keys(picked).length;
      const KINDS=[
        {id:"hypertrophy",label:"Hypertrophy",sub:"Weights & reps",Icon:Icons.Dumbbell,color:"var(--success)"},
        {id:"tendon",label:"Tendon",sub:"Isometrics, HSR & plyos",Icon:Icons.Tendon,color:"var(--danger)"},
        {id:"stretch",label:"Stretching",sub:"Mobility & timed holds",Icon:Icons.Stretch,color:"#0a84ff"},
      ];
      const db=kind==="tendon"?TENDON_DB:kind==="stretch"?STRETCH_DB:null;
      const defName=kind==="tendon"?"New Tendon Block":kind==="stretch"?"New Mobility Routine":"New Split";
      const save=()=>{
        const pCount=Math.max(1,Math.min(8,parseInt(phaseCount)||1));
        const phases=Array.from({length:pCount},(_,i)=>`Phase ${i+1}`);
        let exercises=pickedToExercises(picked,kind);
        if(exercises.length===0){
          if(kind==="stretch")exercises=[{id:uid(),name:"Stretch 1",equip:"Stretch",sets:1,reps:"",hold:"45s",totalSec:45,rest:"15s",weight:"",cue:""}];
          else if(kind==="tendon")exercises=[{id:uid(),name:"Hold 1",equip:"Tendon",sets:3,reps:"",hold:"30s",rest:"90s",weight:"",cue:""}];
          else exercises=[{id:uid(),name:"Exercise 1",equip:"Bodyweight",sets:1,reps:"8-12",hold:"",rest:"90s",weight:"",cue:""}];
        }
        onSave({id:uid(),section:name.trim()||defName,description:"",phases,exercises,kind});
      };
      if(step===0){
        return (
          <TapModal isOpen onClose={onClose}>
            <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>New Split</h2>
            <p className="text-small" style={{marginBottom:"16px"}}>What kind of training is this? It sets the exercise library you pick from.</p>
            {KINDS.map(k=>(
              <button key={k.id} onClick={()=>{setKind(k.id);setStep(1);}} className="card" style={{width:"100%",display:"flex",alignItems:"center",gap:"14px",padding:"16px",marginBottom:"10px",textAlign:"left",border:`1.5px solid ${k.color}`}}>
                <span style={{color:k.color,display:"flex"}}><k.Icon/></span>
                <span style={{flex:1}}>
                  <span style={{display:"block",fontWeight:"800",fontSize:"16px"}}>{k.label}</span>
                  <span className="text-small" style={{fontSize:"12px"}}>{k.sub}</span>
                </span>
                <span style={{color:"var(--text-secondary)",fontSize:"18px"}}>→</span>
              </button>
            ))}
            <button className="button-secondary" style={{marginTop:"6px"}} onClick={onClose}>Cancel</button>
          </TapModal>
        );
      }
      const active=KINDS.find(k=>k.id===kind)||KINDS[0];
      return (
        <TapModal isOpen onClose={onClose}>
          <button onClick={()=>{setStep(0);setPicked({});}} style={{fontSize:"13px",fontWeight:"800",color:"var(--text-secondary)",marginBottom:"8px"}}>← Type</button>
          <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px",display:"flex",alignItems:"center",gap:"8px"}}><span style={{color:active.color,display:"flex"}}><active.Icon/></span>{active.label} Split</h2>
          <p className="text-small" style={{marginBottom:"14px"}}>{kind==="hypertrophy"?"Group your existing exercises or pick from the library.":kind==="tendon"?"Pick tendon isometrics, HSR and reactive work from the library.":"Pick mobility drills and stretches from the library."}</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px",gap:"10px"}}>
            <div><label className="field-label">Split name</label><input className="field" placeholder={defName} value={name} onChange={e=>setName(e.target.value)}/></div>
            <div><label className="field-label">Phases</label><input className="field" type="number" min="1" max="8" value={phaseCount} onChange={e=>setPhaseCount(e.target.value)}/></div>
          </div>
          <ExercisePickList sections={kind==="hypertrophy"?sections:null} db={db} allowCreate={kind==="hypertrophy"} picked={picked} setPicked={setPicked} query={query} setQuery={setQuery}/>
          <button className="button-primary" style={{marginTop:"14px"}} onClick={save}>{count>0?`Create "${name.trim()||defName}" — ${count} item${count>1?"s":""}`:"Create blank split"}</button>
          <button className="button-secondary" style={{marginTop:"10px"}} onClick={onClose}>Cancel</button>
        </TapModal>
      );
    }

    function CustomSplitTab({split,setWorkouts,weights,saveWeight,setActiveRoutine,notes,saveNote,tileColor,allSections}) {
      const [editMode,setEditMode]=useState(false);
      const [phaseIdx,setPhaseIdx]=useState(0);
      const [pickerOpen,setPickerOpen]=useState(false);
      const [picked,setPicked]=useState({});
      const [pickQuery,setPickQuery]=useState("");
      const accent=tileColor||"var(--accent)";
      const phases=split.phases&&split.phases.length?split.phases:["Phase 1"];
      const splitKey=split.id||split.section;
      const saveSplit=patch=>{
        setWorkouts(prev=>{
          const u=prev.map(s=>(s.id||s.section)===splitKey?{...s,...patch}:s);
          store.set("workout_sections_custom",u);
          return u;
        });
      };
      const moveExercise=(idx,direction)=>{
        const exercises=[...split.exercises];const targetIdx=idx+direction;
        if(targetIdx<0||targetIdx>=exercises.length)return;
        [exercises[idx],exercises[targetIdx]]=[exercises[targetIdx],exercises[idx]];
        saveSplit({exercises});
      };
      const updateExercise=(idx,patch)=>saveSplit({exercises:split.exercises.map((e,i)=>i===idx?{...e,...patch}:e)});
      const deleteExercise=idx=>saveSplit({exercises:split.exercises.filter((_,i)=>i!==idx)});
      const addExercise=()=>saveSplit({exercises:[...split.exercises,{id:uid(),name:`Exercise ${split.exercises.length+1}`,equip:"Bodyweight",sets:1,reps:"8-12",rest:"90s",weight:"",cue:""}]});
      const updatePhase=(idx,value)=>saveSplit({phases:phases.map((p,i)=>i===idx?value:p)});
      const addPhase=()=>saveSplit({phases:[...phases,`Phase ${phases.length+1}`]});
      const deletePhase=idx=>saveSplit({phases:phases.filter((_,i)=>i!==idx)});
      const launch=()=>setActiveRoutine({name:`${split.section} Workout`,color:tileColor,exercises:split.exercises.map(e=>withSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
      const duplicateSplit = () => {
        const newSplit = { ...split, id: uid(), section: `${split.section} (Copy)` };
        setWorkouts(prev => { const u = [...prev, newSplit]; store.set("workout_sections_custom", u); return u; });
      };
      const exportSplit = () => {
        const data = JSON.stringify(split, null, 2);
        navigator.clipboard?.writeText(data).then(() => alert('Split copied to clipboard!')).catch(() => {
          prompt('Copy this JSON:', data);
        });
      };
      return (
        <div style={accentVars(tileColor)}>
          <div className="card">
            <div className="flex-between">
              <div style={{flex:1}}>
                {editMode?(<input className="field" style={{marginBottom:"8px"}} value={split.section} onChange={e=>saveSplit({section:e.target.value})}/>):(<Editable as="h2" className="font-bold" style={{fontSize:"22px"}} value={split.section} onSave={t=>saveSplit({section:t})}/>)}
                {editMode?(<textarea className="field" rows="2" value={split.description||""} onChange={e=>saveSplit({description:e.target.value})} placeholder="Optional description"/>):(<p className="text-small">{split.description||`${split.exercises.length} exercises`}</p>)}
              </div>
              <div style={{display:"flex",gap:"6px",flexDirection:"column",alignItems:"flex-end"}}>
                <button className="button-secondary" style={{width:"auto",padding:"8px 12px",fontSize:"12px",borderColor:editMode?accent:"var(--card-border)",color:editMode?accent:"var(--text)"}} onClick={()=>setEditMode(e=>!e)}>{editMode?"Done":"Edit"}</button>
                <div style={{display:"flex",gap:"4px"}}>
                  <button onClick={duplicateSplit} style={{padding:"4px 8px",borderRadius:"6px",fontSize:"10px",fontWeight:"700",background:"var(--input-bg)",border:"1px solid var(--card-border)",color:"var(--text-secondary)"}}>Duplicate</button>
                  <button onClick={exportSplit} style={{padding:"4px 8px",borderRadius:"6px",fontSize:"10px",fontWeight:"700",background:"var(--input-bg)",border:"1px solid var(--card-border)",color:"var(--text-secondary)"}}>Export</button>
                </div>
              </div>
            </div>
            <button className="button-primary" style={{marginTop:"14px",background:accent,borderColor:accent}} onClick={launch}>Start</button>
          </div>
          <div className="card" style={{padding:"10px",display:"flex",gap:"8px",overflowX:"auto"}}>
            {phases.map((p,i)=>editMode?(
              <div key={i} style={{display:"flex",gap:"6px",alignItems:"center",minWidth:"130px"}}>
                <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"8px"}} value={p} onChange={e=>updatePhase(i,e.target.value)}/>
                <button onClick={()=>deletePhase(i)} style={{color:"var(--danger)",fontWeight:"900"}}>×</button>
              </div>
            ):(
              <button key={i} onClick={()=>setPhaseIdx(i)} style={{flex:"1 0 auto",padding:"9px 12px",borderRadius:"10px",background:phaseIdx===i?accent:"transparent",color:phaseIdx===i?"var(--btn-text)":"var(--text-secondary)",fontWeight:"700"}}>{p}</button>
            ))}
            {editMode&&<button className="button-secondary" style={{width:"auto",padding:"8px 12px",fontSize:"13px"}} onClick={addPhase}>+ Phase</button>}
          </div>
          <div className="card">
            <h3 className="font-bold" style={{fontSize:"16px",marginBottom:"10px"}}>Exercises</h3>
            {split.exercises.map((ex,i)=>{
              const exKey = ex.id || ex.name;
              return (
              <div key={exKey} className="flex-between" style={{padding:"10px 0",borderBottom:i+1<split.exercises.length?"0.5px solid var(--card-border)":"none",gap:"10px"}}>
                {editMode?(
                  <div style={{flex:1,display:"flex",gap:"6px",alignItems:"flex-start"}}>
                    <div style={{display:"flex",flexDirection:"column",gap:"2px"}}>
                      <button onClick={()=>moveExercise(i,-1)} disabled={i===0} style={{opacity:i===0?0.3:1,padding:"2px 6px",fontSize:"12px"}}>▲</button>
                      <button onClick={()=>moveExercise(i,1)} disabled={i===split.exercises.length-1} style={{opacity:i===split.exercises.length-1?0.3:1,padding:"2px 6px",fontSize:"12px"}}>▼</button>
                    </div>
                    <div style={{flex:1,display:"flex",flexDirection:"column",gap:"6px"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 58px 72px",gap:"8px",alignItems:"center"}}>
                        <input className="field" style={{marginBottom:0,fontSize:"14px",padding:"8px"}} value={ex.name} onChange={e=>updateExercise(i,{name:e.target.value})}/>
                        <input className="field" style={{marginBottom:0,fontSize:"14px",padding:"8px"}} type="number" min="1" value={ex.sets} onChange={e=>updateExercise(i,{sets:parseInt(e.target.value)||1})}/>
                        <input className="field" style={{marginBottom:0,fontSize:"14px",padding:"8px"}} value={ex.reps||ex.hold||""} onChange={e=>updateExercise(i,{reps:e.target.value})}/>
                      </div>
                      <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                        <span className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"700"}}>Rest</span>
                        <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"7px",width:"78px"}} value={ex.rest||""} placeholder="90s" onChange={e=>updateExercise(i,{rest:e.target.value})}/>
                        <SideToggle ex={ex} onChange={v=>updateExercise(i,{unilateral:v})}/>
                        {i<split.exercises.length-1&&<button onClick={()=>updateExercise(i,{supersetWithNext:!ex.supersetWithNext})} title="Superset with the next exercise"
                          style={{padding:"6px 9px",borderRadius:"8px",fontSize:"11px",fontWeight:"800",flexShrink:0,
                            border:`1.5px solid ${ex.supersetWithNext?"var(--accent)":"var(--card-border)"}`,
                            color:ex.supersetWithNext?"var(--accent)":"var(--text-secondary)",
                            background:ex.supersetWithNext?"var(--accent-muted)":"var(--input-bg)",display:"inline-flex",alignItems:"center",gap:"4px"}}><Icons.Link/>SS</button>}
                      </div>
                    </div>
                  </div>
                ):(
                  <div style={{flex:1}}>
                    <Editable as="p" className="font-bold" value={ex.name} onSave={t=>updateExercise(i,{name:t})}/>
                    <p className="text-small">{ex.sets} sets — {ex.reps||ex.hold}
                      {exerciseHasSides(ex)&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>L+R</span>}
                      {ex.supersetWithNext&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>SS</span>}
                      <span className="badge" style={{fontSize:"9px",marginLeft:"4px",opacity:0.75}}>{muscleGroupOf(ex.name)}</span>
                    </p>
                    <PreviousPerformanceBanner exerciseId={exKey} exerciseName={ex.name} compact/>
                    <Editable as="p" multiline className="text-small" style={{fontSize:"12px",marginTop:"3px",fontStyle:"italic",opacity:0.8,lineHeight:"1.35"}} value={ex.cue||""} placeholder="Double-tap to add cue…" onSave={t=>updateExercise(i,{cue:t})}/>
                  </div>
                )}
                {editMode?<button onClick={()=>deleteExercise(i)} style={{width:"34px",height:"34px",borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",fontSize:"20px",fontWeight:"900"}}>×</button>:(
                  <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
                    <ExerciseNoteButton exerciseId={exKey} notes={notes} onSave={saveNote}/>
                    <WeightChip exKey={exKey} defaultWeight={ex.weight} color="var(--accent)" weights={weights} onSave={saveWeight}/>
                  </div>
                )}
              </div>
            );})}
            {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"12px",flexWrap:"wrap"}}>
              <button className="button-secondary" onClick={addExercise}>+ Add Exercise</button>
              <button className="button-secondary" onClick={()=>setPickerOpen(true)}><Icons.Library/> From Library</button>
              <button className="button-secondary" onClick={()=>{
                const v=prompt("Rest time for ALL exercises in this split (e.g. 90s or 2 min):");
                if(!v)return;
                saveSplit({exercises:split.exercises.map(e=>({...e,rest:v.trim()}))});
              }}><Icons.Clock/> Rest for all</button>
            </div>}
            {pickerOpen&&(
              <TapModal isOpen onClose={()=>{setPickerOpen(false);setPicked({});setPickQuery("");}}>
                <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>Add Exercises</h2>
                <p className="text-small" style={{marginBottom:"14px"}}>Pick from your sections or the library — settings (weight, reps, L/R) are copied across.</p>
                <ExercisePickList sections={split.kind&&split.kind!=="hypertrophy"?null:allSections} db={split.kind==="tendon"?TENDON_DB:split.kind==="stretch"?STRETCH_DB:null} allowCreate={!split.kind||split.kind==="hypertrophy"} picked={picked} setPicked={setPicked} query={pickQuery} setQuery={setPickQuery}/>
                <button className="button-primary" style={{marginTop:"14px"}} disabled={!Object.keys(picked).length} onClick={()=>{
                  saveSplit({exercises:[...split.exercises,...pickedToExercises(picked,split.kind)]});
                  setPickerOpen(false);setPicked({});setPickQuery("");
                }}>Add {Object.keys(picked).length||""} to {split.section}</button>
                <button className="button-secondary" style={{marginTop:"10px"}} onClick={()=>{setPickerOpen(false);setPicked({});setPickQuery("");}}>Cancel</button>
              </TapModal>
            )}
          </div>
        </div>
      );
    }

    // ── App ────────────────────────────────────────────────────────────────────
    function AccentPicker({value,onPick,theme}) {
      const disabled = theme==='anti-red';
      return (
        <div className="card" style={disabled?{opacity:0.5}:{}}>
          <p className="font-bold" style={{marginBottom:"3px"}}>Accent colour</p>
          <p className="text-small" style={{marginBottom:"12px"}}>{disabled?"The Anti-Red theme uses its own gold accent.":"Sets the app's highlight colour everywhere."}</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:"12px"}}>
            {ACCENT_PALETTES.map(p=>{
              const active=value===p.color;
              return (
                <button key={p.id} disabled={disabled} onClick={()=>onPick(p.color)} title={p.name}
                  style={{width:"40px",height:"40px",borderRadius:"50%",background:p.color,flexShrink:0,position:"relative",
                    boxShadow:active?`0 0 0 3px var(--bg), 0 0 0 5px ${p.color}`:"none",transition:"box-shadow 0.15s"}}>
                  {active&&<span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",mixBlendMode:"difference"}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </span>}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    function Onboarding({initialName,onDone}) {
      const [name,setName]=useState(initialName||"");
      const [target,setTarget]=useState(3);
      const [accent,setAccent]=useState("#16d6a4");
      return (
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",justifyContent:"center",padding:"32px 24px",maxWidth:"430px",margin:"0 auto"}}>
          <div style={{width:"72px",height:"72px",borderRadius:"22px",background:"var(--accent-muted)",border:"1.5px solid var(--accent)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--accent)",marginBottom:"28px"}}>
            <Icons.Dumbbell/>
          </div>
          <p className="text-small" style={{fontSize:"12px",fontWeight:"800",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:"10px"}}>Workout Flow</p>
          <h1 style={{fontSize:"36px",fontWeight:"900",lineHeight:"1.1",letterSpacing:"-0.02em",marginBottom:"10px"}}>Train hard.<br/>Track everything.</h1>
          <p className="text-small" style={{fontSize:"15px",marginBottom:"32px",lineHeight:"1.5"}}>Workouts, tendon work and mobility — logged on your device, nowhere else.</p>
          <label className="field-label">What should we call you?</label>
          <input className="field" autoFocus placeholder="Your name" value={name} maxLength={20} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&name.trim())onDone({name:name.trim(),weeklyTarget:target,accent,created:todayStr()});}}/>
          <label className="field-label" style={{marginTop:"14px"}}>Weekly workout target</label>
          <div style={{display:"flex",gap:"8px",marginBottom:"10px"}}>
            {[2,3,4,5,6].map(n=>(
              <button key={n} onClick={()=>setTarget(n)} style={{flex:1,padding:"13px 0",borderRadius:"12px",fontSize:"16px",fontWeight:"800",
                border:`1.5px solid ${target===n?accent:"var(--card-border)"}`,
                color:target===n?accent:"var(--text-secondary)",
                background:target===n?`${accent}26`:"var(--input-bg)"}}>{n}</button>
            ))}
          </div>
          <input className="field" type="number" min="1" max="14" placeholder="Or type a custom number" value={target} onChange={e=>setTarget(Math.max(1,Math.min(14,parseInt(e.target.value)||1)))} style={{marginBottom:"22px"}}/>
          <label className="field-label">Accent colour</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:"12px",marginBottom:"30px"}}>
            {ACCENT_PALETTES.map(p=>(
              <button key={p.id} onClick={()=>{setAccent(p.color);applyAppAccent(p.color);}} title={p.name}
                style={{width:"38px",height:"38px",borderRadius:"50%",background:p.color,flexShrink:0,
                  boxShadow:accent===p.color?`0 0 0 3px var(--bg), 0 0 0 5px ${p.color}`:"none"}}/>
            ))}
          </div>
          <button className="button-primary" disabled={!name.trim()} style={!name.trim()?{opacity:0.45}:{}} onClick={()=>onDone({name:name.trim(),weeklyTarget:target,accent,created:todayStr()})}>Let's go</button>
        </div>
      );
    }

    function App() {
      const [activeTab,setActiveTab]=useState("home");
      const [theme,setTheme]=useState(()=>{
        const t=store.get("workout_theme","dark");
        document.documentElement.setAttribute('data-theme',t);
        return t;
      });
      const [appAccent,setAppAccent]=useState(()=>store.get("app_accent","#16d6a4"));
      const chooseAccent=c=>{setAppAccent(c);store.set("app_accent",c);};
      useEffect(()=>{ if(theme==='anti-red') applyAppAccent(null); else applyAppAccent(appAccent); },[appAccent,theme]);
      const [username,setUsername]=useState(()=>store.get("workout_username","Abiram"));
      const [profile,setProfile]=useState(()=>store.get("user_profile",null));
      const [settingsOpen,setSettingsOpen]=useState(false);
      // Fade out the static splash once React is in charge
      useEffect(()=>{try{const s=document.getElementById('splash');if(s){s.style.opacity='0';setTimeout(()=>{try{s.remove();}catch{}},400);}}catch{}},[]);
      const [editingName,setEditingName]=useState(false);
      const [hiddenTabs,setHiddenTabs]=useState(()=>store.get("workout_hidden_tabs",[]));
      const [weights,setWeights]=useState(()=>store.get("workout_weights",{}));
      const [customReps,setCustomReps]=useState(()=>store.get("workout_reps",{}));
      const [notes,setNotes]=useState(()=>store.get("workout_notes",{}));
      const [tileMeta,setTileMeta]=useState(()=>store.get("workout_tile_meta",{}));
      const [tileColorEdit,setTileColorEdit]=useState(null);
      const saveTileMeta=(id,patch)=>{const u={...tileMeta,[id]:{...(tileMeta[id]||{}),...patch}};setTileMeta(u);store.set("workout_tile_meta",u);};
      // Tile colour chosen on the Home screen drives the buttons inside that tab
      const tileColorFor=id=>{const c=(tileMeta[id]||{}).color;return c?getThemeColor(c,theme):null;};
      // The exact colour a Home tile shows (custom colour if set, else its default) — used so the
      // bottom tab matches the Home tile on first paint, not only after it becomes active.
      // Real hex defaults per tile so the colour can drive the whole page accent
      // (accentVars needs hex, not CSS vars). Matches the Home tile palette.
      const TILE_DEFAULT_COLOR=(()=>{
        const light = theme==='light';
        return {
          workouts: light?"#34c759":"#30d158",   // green
          tendons:  light?"#ff3b30":"#ff453a",   // red
          stretches:"#0a84ff",                    // blue
        };
      })();
      const tileDisplayColor=id=>{
        const custom=(tileMeta[id]||{}).color;
        if(custom){const c=getThemeColor(custom,theme);return c&&c.startsWith("var(")?null:c;}
        if(theme==='anti-red')return null; // anti-red forces its own gold everywhere
        return TILE_DEFAULT_COLOR[id]||null;
      };
      const tileLabelFor=(id,fallback)=>(tileMeta[id]||{}).label||fallback;
      const [workouts,setWorkouts]=useState(()=>{
        const saved=store.get("workout_sections_custom",null);
        if(!saved)return FB_SECTIONS;
        // v2 migration: replace any existing "Full Body" with the new 25-exercise version once.
        const done=store.get("fullbody_v2_done",false);
        const fbNew=FB_SECTIONS.find(s=>s.section==="Full Body");
        if(!done){
          const others=saved.filter(s=>s.section!=="Full Body");
          const merged=[fbNew,...others];
          store.set("workout_sections_custom",merged);
          store.set("fullbody_v2_done",true);
          return merged;
        }
        return saved;
      });
      const saveReps=(k,v)=>{const u={...customReps,[k]:v};setCustomReps(u);store.set("workout_reps",u);};
      const saveNote=(k,v)=>{const u={...notes,[k]:v};if(!v)delete u[k];setNotes(u);store.set("workout_notes",u);};
      const [logs,setLogs]=useState(()=>store.get("workout_logs",[]));
      const [counts,setCounts]=useState(()=>store.get("workout_completed_counts",{workouts:0,tendons:0,stretches:0}));
      const [activeRoutine,setActiveRoutine]=useState(()=>{const s=store.get('active_session',null);return s&&s.routine&&s.routine.exercises&&s.routine.exercises.length?s.routine:null;});
      const [resumeState,setResumeState]=useState(()=>{const s=store.get('active_session',null);return s&&s.routine&&s.routine.exercises&&s.routine.exercises.length?(s.state||null):null;});
      const [sessionMinimized,setSessionMinimized]=useState(()=>{const s=store.get('active_session',null);return !!(s&&s.routine&&s.routine.exercises&&s.routine.exercises.length);});
      // Any time a new routine starts, ensure the player is expanded & fresh.
      const startRoutine=r=>{setResumeState(null);setSessionMinimized(false);store.set('active_session',{routine:r,state:null});setActiveRoutine(r);};
      const persistSession=(state)=>{ if(activeRoutine) store.set('active_session',{routine:activeRoutine,state}); };
      const endSession=()=>{ store.set('active_session',null); setActiveRoutine(null); setResumeState(null); setSessionMinimized(false); };
      const [modalContent,setModalContent]=useState(null);
      const [importModal,setImportModal]=useState(false);
      const [importJson,setImportJson]=useState('');
      const customSplits=workouts.filter(s=>s.description!==undefined||s.phases);
      const activeCustomSplit=customSplits.find(s=>`split-${s.id||s.section}`===activeTab);

      useEffect(()=>{document.documentElement.setAttribute('data-theme',theme);store.set("workout_theme",theme);},[theme]);
      const reloadLogs=()=>{setLogs(store.get("workout_logs",[]));setCounts(store.get("workout_completed_counts",{workouts:0,tendons:0,stretches:0}));};
      const saveWeight=(k,v)=>{const u={...weights,[k]:v};setWeights(u);store.set("workout_weights",u);};
      const cycleTheme=()=>{const t=["dark","light","anti-red"];setTheme(t[(t.indexOf(theme)+1)%t.length]);};
      const saveHiddenTabs=ids=>{setHiddenTabs(ids);store.set("workout_hidden_tabs",ids);};
      const addSplit=split=>{const u=[...workouts,split];setWorkouts(u);store.set("workout_sections_custom",u);setModalContent(null);setActiveTab(`split-${split.id}`);};
      const deleteHomeSplit=id=>{
        if(!confirm("Delete this split?")) return;
        if(["workouts","tendons","stretches"].includes(id)){saveHiddenTabs([...new Set([...hiddenTabs,id])]);if(activeTab===id)setActiveTab("home");return;}
        const u=workouts.filter(s=>(s.id||s.section)!==id);setWorkouts(u);store.set("workout_sections_custom",u);if(activeTab===`split-${id}`)setActiveTab("home");
      };
      const handleImportSplit = () => {
        try {
          const parsed = JSON.parse(importJson);
          if (!parsed.section && !parsed.name) throw new Error('Invalid');
          const newSplit = { ...parsed, id: uid(), section: parsed.section || parsed.name || 'Imported Split' };
          if (!newSplit.exercises) newSplit.exercises = [];
          newSplit.exercises = newSplit.exercises.map(e => ({ ...e, id: e.id || uid() }));
          if (!newSplit.phases) newSplit.phases = ['Phase 1'];
          if (newSplit.description === undefined) newSplit.description = 'Imported';
          addSplit(newSplit);
          setImportModal(false);
          setImportJson('');
        } catch { alert('Invalid JSON. Please paste a valid split export.'); }
      };

      const handleEditSave=updatedEx=>{
        if(!modalContent?.data) return;
        const u=workouts.map(s=>s.section===modalContent.data.secName?{...s,exercises:s.exercises.map(e=>e.name===modalContent.data.ex.name?updatedEx:e)}:s);
        setWorkouts(u); store.set("workout_sections_custom",u); setModalContent(null);
      };
      const handleEditDelete=()=>{
        if(!modalContent?.data) return;
        const u=workouts.map(s=>s.section===modalContent.data.secName?{...s,exercises:s.exercises.filter(e=>e.name!==modalContent.data.ex.name)}:s);
        setWorkouts(u); store.set("workout_sections_custom",u); setModalContent(null);
      };

      // ── Home tab ─────────────────────────────────────────────────────────────
      const renderHome=()=>{
        const today=new Date();
        const streaks = calculateStreaks();
        const last30=[];
        for(let i=29;i>=0;i--){
          const d=new Date(); d.setDate(today.getDate()-i);
          const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const dl=logs.filter(l=>l.date===ds);
          let status="none";
          if(dl.length>0) status=dl.some(l=>!l.isPartial)?"completed":"partial";
          last30.push({date:ds,dayNum:d.getDate(),status,logs:dl});
        }
        const showDay=day=>{if(day.logs.length>0) setModalContent({type:"day_details",data:day});};
        // ── This Week (Mon–Sun) ──
        const weeklyTarget=(profile&&profile.weeklyTarget)||3;
        const dow=(today.getDay()+6)%7; // 0 = Monday
        const weekDays=Array.from({length:7},(_,i)=>{
          const d=new Date(today); d.setDate(today.getDate()-dow+i);
          const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          const dl=logs.filter(l=>l.date===ds);
          return {ds,label:"MTWTFSS"[i],isToday:ds===todayStr(),isFuture:i>dow,status:dl.length===0?"none":dl.some(l=>!l.isPartial)?"completed":"partial"};
        });
        const weekCount=logs.filter(l=>weekDays.some(d=>d.ds===l.date)).length;
        const ringPct=Math.min(1,weekCount/weeklyTarget);
        const trainedToday=logs.some(l=>l.date===todayStr());
        // ── Today's suggestion: least-recently-trained launchable routine ──
        const lr=store.get('workout_last_routine',null);
        const candidates=[
          {name:store.get("workouts_fullbody_name","Full Body"),go:()=>setActiveTab("workouts")},
          ...customSplits.map(s=>({name:s.section,go:()=>setActiveTab(`split-${s.id||s.section}`)})),
        ];
        candidates.forEach(c=>{
          const last=logs.filter(l=>l.routine===c.name).map(l=>l.date).sort().pop();
          c.last=last||null;
        });
        const suggestion=[...candidates].sort((a,b)=>(a.last||"0").localeCompare(b.last||"0"))[0]||candidates[0];
        const canDirectStart=lr&&lr.exercises&&lr.exercises.length&&suggestion&&lr.name===suggestion.name;
        const homeTiles=[
          !hiddenTabs.includes("workouts")&&{id:"workouts",label:"Workouts",Icon:Icons.Dumbbell,color:"var(--success)"},
          !hiddenTabs.includes("tendons")&&{id:"tendons",label:"Tendon",Icon:Icons.Tendon,color:"var(--danger)"},
          !hiddenTabs.includes("stretches")&&{id:"stretches",label:"Stretch",Icon:Icons.Stretch,color:"#0a84ff"},
          ...workouts.filter(s=>s.description!==undefined||s.phases).map(s=>({id:s.id||s.section,label:s.section,Icon:s.kind==="tendon"?Icons.Tendon:s.kind==="stretch"?Icons.Stretch:Icons.Dumbbell,color:s.kind==="tendon"?"var(--danger)":s.kind==="stretch"?"#0a84ff":"var(--success)",custom:true})),
        ].filter(Boolean);
        return (
          <div>
            <div style={{padding:"18px 0 22px",borderBottom:"1px solid var(--card-border)",marginBottom:"18px"}}>
              <div className="flex-between" style={{marginBottom:"14px"}}>
                <p style={{fontSize:"13px",fontWeight:"800",color:"var(--text-secondary)",letterSpacing:"0.12em",textTransform:"uppercase"}}>Workout</p>
                <button onClick={()=>setSettingsOpen(true)} title="Settings" style={{color:"var(--text-secondary)",padding:"6px",display:"flex"}}><Icons.Gear/></button>
              </div>
              {editingName?(
                <input className="field" autoFocus value={username} onChange={e=>{setUsername(e.target.value);store.set("workout_username",e.target.value);}} onBlur={()=>setEditingName(false)} onKeyDown={e=>{if(e.key==="Enter")setEditingName(false)}}/>
              ):(
                <button onClick={()=>setEditingName(true)} style={{textAlign:"left",display:"block"}}>
                  <h1 style={{fontSize:"34px",lineHeight:"1.1",fontWeight:"900",letterSpacing:"-0.02em"}}>{(()=>{const h=today.getHours();return h<12?"Good morning":h<18?"Good afternoon":"Good evening";})()}, {username||"there"}.</h1>
                  <p className="text-small" style={{fontSize:"15px",marginTop:"6px"}}>{today.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</p>
                </button>
              )}
            </div>

            {/* This Week: goal ring + day dots */}
            <div className="card" style={{display:"flex",alignItems:"center",gap:"20px"}}>
              <div style={{position:"relative",width:"82px",height:"82px",flexShrink:0}}>
                <svg width="82" height="82" viewBox="0 0 82 82">
                  <circle cx="41" cy="41" r="35" fill="none" stroke="var(--input-bg)" strokeWidth="8"/>
                  <circle cx="41" cy="41" r="35" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={`${2*Math.PI*35}`} strokeDashoffset={`${2*Math.PI*35*(1-ringPct)}`}
                    transform="rotate(-90 41 41)" style={{transition:"stroke-dashoffset 0.6s ease"}}/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <span className="stat-num" style={{fontSize:"26px",fontWeight:"900",lineHeight:"1"}}>{weekCount}</span>
                  <span className="text-small" style={{fontSize:"10px"}}>of {weeklyTarget}</span>
                </div>
              </div>
              <div style={{flex:1}}>
                <p className="section-label" style={{marginBottom:"10px"}}>This Week</p>
                <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
                  {weekDays.map((d,i)=>(
                    <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"5px"}}>
                      <span className="text-small" style={{fontSize:"9px",fontWeight:"700"}}>{d.label}</span>
                      <span style={{width:"13px",height:"13px",borderRadius:"50%",
                        background:d.status==="completed"?"var(--accent)":d.status==="partial"?"var(--accent-muted)":"var(--input-bg)",
                        boxShadow:d.isToday?"0 0 0 2px var(--accent)":"none",
                        opacity:d.isFuture?0.35:1}}/>
                    </div>
                  ))}
                </div>
                <p className="text-small" style={{fontSize:"12px"}}>{weekCount>=weeklyTarget?"Weekly target hit — strong week.":`${weeklyTarget-weekCount} more to hit your target.`}</p>
              </div>
            </div>

            {/* Today's session */}
            <div className="card" style={trainedToday?{}:{borderColor:"var(--accent)",borderWidth:"1.5px"}}>
              <p className="section-label" style={{marginBottom:"6px"}}>Today</p>
              {trainedToday?(
                <div className="flex-between">
                  <div>
                    <p className="font-bold" style={{fontSize:"17px"}}>Session logged ✓</p>
                    <p className="text-small" style={{marginTop:"2px"}}>Recovery matters — see you tomorrow.</p>
                  </div>
                </div>
              ):(
                <div>
                  <div className="flex-between">
                    <div>
                      <p className="font-bold" style={{fontSize:"17px"}}>{suggestion?suggestion.name:"Train"}</p>
                      <p className="text-small" style={{marginTop:"2px"}}>{suggestion&&suggestion.last?`Last done ${suggestion.last}`:"Not trained yet — good day to start"}</p>
                    </div>
                    <button className="button-primary" style={{width:"auto",padding:"11px 22px",fontSize:"15px"}} onClick={()=>{
                      if(canDirectStart)startRoutine({name:lr.name,color:lr.color,exercises:lr.exercises});
                      else if(suggestion)suggestion.go();
                    }}>{canDirectStart?"Start":"Open"}</button>
                  </div>
                  {lr&&lr.exercises&&lr.exercises.length&&!canDirectStart?(
                    <button className="button-secondary" style={{marginTop:"12px",padding:"9px",fontSize:"13px"}} onClick={()=>startRoutine({name:lr.name,color:lr.color,exercises:lr.exercises})}>Repeat last: {lr.name}</button>
                  ):null}
                </div>
              )}
            </div>

            {/* Streak Card */}
            {(streaks.current > 0 || streaks.longest > 0) && (
              <div className="card streak-card">
                <div style={{display:"flex",gap:"24px",position:"relative",zIndex:1}}>
                  <div>
                    <p className="text-small font-bold" style={{textTransform:"uppercase",fontSize:"10px",letterSpacing:"0.08em"}}>Current Streak</p>
                    <p style={{fontSize:"28px",fontWeight:"900",color:"var(--warning)",lineHeight:"1.1",display:"flex",alignItems:"center",gap:"6px"}}><Icons.Flame/>{streaks.current} <span style={{fontSize:"14px",fontWeight:"600"}}>days</span></p>
                  </div>
                  <div>
                    <p className="text-small font-bold" style={{textTransform:"uppercase",fontSize:"10px",letterSpacing:"0.08em"}}>Longest</p>
                    <p style={{fontSize:"28px",fontWeight:"900",lineHeight:"1.1"}}>{streaks.longest} <span style={{fontSize:"14px",fontWeight:"600"}}>days</span></p>
                  </div>
                </div>
              </div>
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"14px",marginBottom:"20px"}}>
              {homeTiles.map(tile=>{
                const meta=tileMeta[tile.id]||{};
                const tColor=getThemeColor(meta.color||tile.color,theme);
                const tLabel=meta.label||tile.label;
                const go=()=>tile.custom?setActiveTab(`split-${tile.id}`):setActiveTab(tile.id);
                return (
                <div key={tile.id} role="button" onClick={go} style={{minHeight:"150px",borderRadius:"20px",background:"var(--card-bg)",border:`1.5px solid ${tColor}`,padding:"22px",textAlign:"left",position:"relative",display:"flex",flexDirection:"column",justifyContent:"space-between",cursor:"pointer"}}>
                  <div style={{position:"absolute",top:"16px",right:"16px",display:"flex",gap:"6px",alignItems:"center"}}>
                    <span onClick={e=>{e.stopPropagation();setTileColorEdit(tile.id);}} title="Change colour" style={{width:"30px",height:"30px",borderRadius:"50%",background:tColor,boxShadow:"0 0 0 1px var(--card-border)",cursor:"pointer"}}/>
                    <span onClick={e=>{e.stopPropagation();deleteHomeSplit(tile.id);}} style={{width:"30px",height:"30px",borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"20px",fontWeight:"900",cursor:"pointer"}}>×</span>
                  </div>
                  <span style={{color:tColor}}><tile.Icon/></span>
                  <Editable value={tLabel} onSave={t=>saveTileMeta(tile.id,{label:t})} singleAction={go} style={{fontSize:"23px",fontWeight:"900"}}/>
                </div>
                );
              })}
              <button onClick={()=>setModalContent({type:"split_builder"})} style={{minHeight:"150px",borderRadius:"20px",background:"var(--card-bg)",border:"1.5px dashed var(--text-secondary)",padding:"22px",textAlign:"left",display:"flex",flexDirection:"column",justifyContent:"space-between",color:"var(--text-secondary)"}}>
                <span style={{fontSize:"42px",lineHeight:"1"}}>+</span>
                <span style={{fontSize:"23px",fontWeight:"900"}}>Add split</span>
              </button>
            </div>

            {/* Tile colour picker */}
            {tileColorEdit && (
              <TapModal isOpen onClose={()=>setTileColorEdit(null)}>
                <h3 className="font-bold" style={{marginBottom:"4px"}}>Tile Colour</h3>
                <p className="text-small" style={{marginBottom:"4px"}}>Pick a colour for this tile.</p>
                <ColorPalette value={(tileMeta[tileColorEdit]||{}).color} onPick={c=>{saveTileMeta(tileColorEdit,{color:c});setTileColorEdit(null);}}/>
                <button className="button-secondary" style={{marginTop:"12px"}} onClick={()=>setTileColorEdit(null)}>Close</button>
              </TapModal>
            )}

            <div className="group-header">Lifetime sessions</div>
            <div className="card">
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"4px"}}>
                <div style={{textAlign:"center"}}><div className="stat-hero text-accent">{counts.workouts}</div><div className="stat-cap">Workouts</div></div>
                <div style={{textAlign:"center"}}><div className="stat-hero text-accent">{counts.tendons}</div><div className="stat-cap">Tendon</div></div>
                <div style={{textAlign:"center"}}><div className="stat-hero text-accent">{counts.stretches}</div><div className="stat-cap">Stretch</div></div>
              </div>
            </div>
            <div className="group-header">Activity</div>
            <div className="card">
              <p className="text-small" style={{marginBottom:"12px"}}>Tap a highlighted day to view session logs</p>
              <div className="calendar-grid">
                {["S","M","T","W","T","F","S"].map((h,i)=><div key={i} className="calendar-header-day">{h}</div>)}
                {Array.from({length:new Date(last30[0].date+'T12:00:00').getDay()}).map((_,i)=><div key={`p${i}`} className="calendar-day-box empty"/>)}
                {last30.map((day,i)=>(
                  <div key={i} onClick={()=>showDay(day)} className={`calendar-day-box ${day.status==="completed"?"completed":""} ${day.status==="partial"?"partial":""} ${day.date===todayStr()?"today":""}`}>
                    <span>{day.dayNum}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Settings sheet */}
            {settingsOpen&&(
              <TapModal isOpen onClose={()=>setSettingsOpen(false)}>
                <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"14px"}}>Settings</h2>
                <AccentPicker value={appAccent} onPick={chooseAccent} theme={theme}/>
                <SoundConfigCard/>
                <TimerConfigCard/>
                <div className="card">
                  <p className="font-bold" style={{marginBottom:"3px"}}>Weekly workout target</p>
                  <p className="text-small" style={{marginBottom:"10px"}}>How many sessions you aim for each week.</p>
                  <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                    <input className="field" type="number" min="1" max="14" style={{marginBottom:0,width:"90px"}} value={(profile&&profile.weeklyTarget)||3} onChange={e=>{const v=Math.max(1,Math.min(14,parseInt(e.target.value)||1));const u={...(profile||{}),weeklyTarget:v};setProfile(u);store.set("user_profile",u);}}/>
                    <span className="text-small">per week</span>
                  </div>
                </div>
                <DataBackupCard/>
                <WakeLockToggle/>
                <button className="button-secondary" style={{marginBottom:"10px",padding:"10px",fontSize:"13px"}} onClick={()=>{setSettingsOpen(false);setImportModal(true);}}>Import Split from JSON</button>
                <button className="button-secondary" onClick={()=>setSettingsOpen(false)}>Done</button>
              </TapModal>
            )}
          </div>
        );
      };

      // ── Modal renderer ────────────────────────────────────────────────────────
      const renderModal=()=>{
        if(!modalContent) return null;
        if(modalContent.type==="day_details"){
          const day=modalContent.data;
          return (
            <TapModal isOpen onClose={()=>setModalContent(null)}>
              <h3 className="font-bold" style={{fontSize:"18px",marginBottom:"12px"}}>{day.date}</h3>
              {day.logs.map((l,i)=>(
                <div key={i} className="card" style={{background:"var(--input-bg)",marginBottom:"8px",position:"relative"}}>
                  <button onClick={()=>{
                    if(confirm(`Delete log for "${l.routine}"?`)){
                      const allLogs = store.get("workout_logs", []);
                      const updatedLogs = allLogs.filter(log => log.id !== l.id);
                      store.set("workout_logs", updatedLogs);
                      const c = {workouts: 0, tendons: 0, stretches: 0};
                      updatedLogs.forEach(log => {
                        if (log.completed > 0) {
                          if (log.routine.includes("Stretch")) c.stretches += 1;
                          else if (log.routine.includes("Tendon")) c.tendons += 1;
                          else c.workouts += 1;
                        }
                      });
                      store.set("workout_completed_counts", c);
                      reloadLogs();
                      const updatedDayLogs = day.logs.filter(log => log.id !== l.id);
                      if (updatedDayLogs.length === 0) setModalContent(null);
                      else setModalContent({type: "day_details", data: {...day, logs: updatedDayLogs}});
                    }
                  }} style={{position:"absolute",top:"12px",right:"12px",width:"24px",height:"24px",borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"16px",fontWeight:"900",zIndex:10}}>×</button>
                  <div className="flex-between" style={{marginRight:"24px"}}>
                    <p className="font-bold">{l.routine}</p>
                    <span className={l.isPartial?"text-warning font-bold":"text-success font-bold"}>{l.isPartial?"Partial":"Done"}</span>
                  </div>
                  <p className="text-small" style={{marginTop:"4px"}}>{l.completed} of {l.total} exercises</p>
                  {l.volume > 0 && <p className="text-small" style={{marginTop:"2px"}}>Volume: {Math.round(l.volume).toLocaleString()}kg</p>}
                  {l.duration > 0 && <p className="text-small" style={{marginTop:"2px"}}>Duration: {l.duration} min</p>}
                </div>
              ))}
            </TapModal>
          );
        }
        if(modalContent.type==="edit_exercise"){
          return (<TapModal isOpen onClose={()=>setModalContent(null)}><EditModal ex={modalContent.data.ex} onSave={handleEditSave} onDelete={handleEditDelete} onClose={()=>setModalContent(null)}/></TapModal>);
        }
        if(modalContent.type==="split_builder"){
          return <SplitBuilderModal sections={workouts} onSave={addSplit} onClose={()=>setModalContent(null)}/>;
        }
        return null;
      };

      if (!profile) return <Onboarding initialName={store.get("workout_username","")} onDone={p=>{store.set("user_profile",p);store.set("workout_username",p.name);if(p.accent){store.set("app_accent",p.accent);setAppAccent(p.accent);}setUsername(p.name);setProfile(p);}}/>;

      return (
        <div>
          <header>
            <div className="app-title font-bold text-accent">WORKOUT</div>
            <button onClick={cycleTheme} style={{border:"1.5px solid var(--card-border)",borderRadius:"20px",padding:"6px 14px",fontSize:"12px",fontWeight:"700",textTransform:"uppercase"}}>
              {theme}
            </button>
          </header>

          {activeRoutine&&(
            <SessionPlayer routineName={activeRoutine.name} routineColor={theme==='anti-red'?null:activeRoutine.color} exercises={activeRoutine.exercises}
              minimized={sessionMinimized}
              resume={resumeState}
              onPersist={persistSession}
              theme={theme}
              onMinimize={()=>setSessionMinimized(true)}
              onFinish={()=>{endSession();reloadLogs();}}
              onCancel={()=>{endSession();}}
              allWeights={weights}
              allNotes={notes}/>
          )}
          {activeRoutine&&sessionMinimized&&(
            <button onClick={()=>setSessionMinimized(false)}
              style={{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:"calc(80px + env(safe-area-inset-bottom))",width:"calc(100% - 32px)",maxWidth:"448px",zIndex:95,
                background:theme!=='anti-red'&&activeRoutine.color&&!String(activeRoutine.color).startsWith("var(")?activeRoutine.color:"var(--accent)",color:"var(--btn-text)",
                borderRadius:"14px",padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",boxShadow:"0 6px 20px rgba(0,0,0,0.35)"}}>
              <span style={{display:"flex",alignItems:"center",gap:"10px",minWidth:0}}>
                <span style={{display:"flex",width:"26px",height:"26px",borderRadius:"50%",background:"rgba(255,255,255,0.25)",alignItems:"center",justifyContent:"center",flexShrink:0}}><Icons.Play size={13}/></span>
                <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",minWidth:0}}>
                  <span style={{fontWeight:"800",fontSize:"14px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"200px"}}>{activeRoutine.name}</span>
                  <span style={{fontSize:"11px",opacity:0.85,fontWeight:"600"}}>Session paused — tap to resume</span>
                </span>
              </span>
              <span style={{fontWeight:"800",fontSize:"13px",flexShrink:0}}>Resume</span>
            </button>
          )}

          <div className="container">
            {activeTab==="home"&&renderHome()}
            {activeTab==="workouts"&&<WorkoutsTab workouts={workouts} setWorkouts={setWorkouts} weights={weights} saveWeight={saveWeight} customReps={customReps} saveReps={saveReps} counts={counts} setActiveRoutine={startRoutine} setModalContent={setModalContent} reloadLogs={reloadLogs} theme={theme} notes={notes} saveNote={saveNote} tileColor={tileDisplayColor("workouts")}/>}
            {activeTab==="tendons"&&<TendonsTab weights={weights} saveWeight={saveWeight} counts={counts} setActiveRoutine={startRoutine} theme={theme} reloadLogs={reloadLogs} notes={notes} saveNote={saveNote} tileColor={tileDisplayColor("tendons")}/>}
            {activeTab==="stretches"&&<StretchesTab counts={counts} setActiveRoutine={startRoutine} theme={theme} reloadLogs={reloadLogs} tileColor={tileDisplayColor("stretches")}/>}
            {activeTab==="progression"&&<ProgressionTab reloadLogs={reloadLogs}/>}
            {activeCustomSplit&&<CustomSplitTab split={activeCustomSplit} setWorkouts={setWorkouts} weights={weights} saveWeight={saveWeight} setActiveRoutine={startRoutine} notes={notes} saveNote={saveNote} tileColor={tileDisplayColor(activeCustomSplit.id||activeCustomSplit.section)} allSections={workouts}/>}
          </div>

          {renderModal()}

          {/* Import Modal */}
          {importModal && (
            <TapModal isOpen onClose={() => { setImportModal(false); setImportJson(''); }}>
              <h3 className="font-bold" style={{marginBottom:"12px"}}>Import Split</h3>
              <p className="text-small" style={{marginBottom:"12px"}}>Paste the JSON export of a split below:</p>
              <textarea className="field" style={{height:"150px",fontFamily:"monospace",fontSize:"12px"}} value={importJson} onChange={e => setImportJson(e.target.value)} placeholder='{"section":"My Split","exercises":[...]}'/>
              <button className="button-primary" onClick={handleImportSplit}>Import</button>
              <button className="button-secondary" style={{marginTop:"8px"}} onClick={() => { setImportModal(false); setImportJson(''); }}>Cancel</button>
            </TapModal>
          )}

          <div className="tab-bar">
            {[{id:"home",label:"Home",Icon:Icons.Home},{id:"workouts",label:tileLabelFor("workouts","Workouts"),Icon:Icons.Dumbbell,tile:"workouts"},{id:"tendons",label:tileLabelFor("tendons","Tendons"),Icon:Icons.Tendon,tile:"tendons"},{id:"stretches",label:tileLabelFor("stretches","Stretch"),Icon:Icons.Stretch,tile:"stretches"},{id:"progression",label:"Progress",Icon:Icons.Chart},...customSplits.map(s=>({id:`split-${s.id||s.section}`,label:tileLabelFor(s.id||s.section,s.section),Icon:s.kind==="tendon"?Icons.Tendon:s.kind==="stretch"?Icons.Stretch:Icons.Dumbbell,tile:s.id||s.section}))].filter(t=>t.id==="home"||t.id==="progression"||t.id.startsWith("split-")||!hiddenTabs.includes(t.id)).map(({id,label,Icon,tile})=>{
              // Inactive tabs stay grey; the active tab shows its real tile colour
              // (custom if set, else the Home default). Home & Progress have no tile,
              // so they fall back to the theme accent when active.
              const active = activeTab===id;
              const tc = active ? (tile ? tileDisplayColor(tile) : null) : null;
              return (
                <button key={id} className={`tab-btn ${active?"active":""}`} style={{width:"auto",flex:"1 1 0",minWidth:"48px",...(tc?{color:tc}:{})}} onClick={()=>setActiveTab(id)}>
                  <Icon/><span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    (async () => {
      try {
        await idb.open();
        const mirror = await idb.getAll();
        Object.keys(mirror).forEach(k => { try { if (localStorage.getItem(k) === null && typeof mirror[k] === 'string') localStorage.setItem(k, mirror[k]); } catch {} });
        for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i);try{idb.set(k,localStorage.getItem(k));}catch{}}
      } catch {}
      ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
    })();
