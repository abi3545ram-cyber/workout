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
    const store = {
      get:(k,d)=>{try{const v=localStorage.getItem(k);if(!v)return d;const p=JSON.parse(v);if(Array.isArray(d)&&!Array.isArray(p))return d;if(d&&typeof d==='object'&&!Array.isArray(d)){if(typeof p!=='object'||p===null||Array.isArray(p))return d;return{...d,...p};}return p;}catch{return d;}},
      set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
    };
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
    const unlockAudio = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      Object.keys(TONES).forEach(k => {
        const a = getToneAudio(k);
        if (!a) return;
        try {
          a.muted = true;
          const p = a.play();
          if (p && p.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; audioUnlocked = false; });
        } catch { a.muted = false; audioUnlocked = false; }
      });
    };

    // WebAudio fallback synth
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
        if (ctx && ctx.state !== 'running') ctx.resume().catch(()=>{});
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
    // Play a named tone: HTMLAudio first, synth fallback if it refuses
    const playTone = key => {
      const a = getToneAudio(key);
      if (a) {
        try {
          const inst = (a.paused || a.ended) ? a : a.cloneNode();
          inst.currentTime = 0;
          const p = inst.play();
          if (p && p.catch) p.catch(() => { const s = TONES[key]; if (s) playSynthTone(s.f, s.d, s.t, s.v); });
          return;
        } catch {}
      }
      const s = TONES[key];
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
      unlockSynth();
      const active = store.get('workout_active_sounds',{tick:true,'rest-chime':true,chime:true,'beep-high':true});
      if (!active[type]) return;
      playTone(type);
    };

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
        </div>
      );
    }

    function SoundConfigCard() {
      const [sounds,setSounds] = useState(()=>store.get('workout_active_sounds',{tick:true,'rest-chime':true,chime:true,'beep-high':true}));
      const toggle = key => { const u={...sounds,[key]:!sounds[key]}; setSounds(u); store.set('workout_active_sounds',u); };
      return (
        <div className="card">
          <p className="font-bold" style={{marginBottom:"10px"}}>Sound Alerts</p>
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
      p1:{label:"Phase 1",weeks:"Weeks 1-4",name:"Isometric",color:"#ff453a",
        meta:"Hold at about 2/10 effort — sustained tension, not force. Take 15g collagen + vit C 30-60 min before. No caffeine.",
        sessions:[
          {label:"Session A",day:"Achilles + Patellar",exercises:[
            {id:"t1a-calf-iso-mid",name:"Calf Raise Iso — Mid Range",equip:"Single leg + DB",sets:3,reps:"6",hold:"30s",weight:"+20-25kg DB",rest:"90s",cue:"Stand on one leg at mid-calf position. Hold completely still. The stimulus is sustained tension — no movement."},
            {id:"t1a-wall-sit",name:"Wall Sit",equip:"Bodyweight",sets:3,reps:"6",hold:"30s",weight:"Bodyweight",rest:"90s",cue:"Back flat against wall, thighs parallel, knees at 90 degrees. Hold. Patellar tendon stimulus."},
            {id:"t1a-calf-bottom",name:"Calf Hold — Bottom Stretch",equip:"Single leg + DB",sets:2,reps:"6",hold:"20s",weight:"+15kg DB",rest:"60s",cue:"Heel dropped off a step as low as possible. Hold at the deepest Achilles stretch."},
            {id:"t1a-hip-flexor",name:"Hip Flexor Lunge Hold",equip:"Bodyweight",sets:2,reps:"6",hold:"20s",weight:"Bodyweight",rest:"60s",single:true,cue:"Back knee on floor, front foot forward, torso upright. Feel the stretch through front of rear hip. Hold still."},
            {id:"t1a-wrist-iso",name:"Wrist Iso Hold",equip:"Light band",sets:2,reps:"6",hold:"15s",weight:"Light band",rest:"45s",single:true,cue:"Press wrist into band and hold without moving. Three positions: neutral, flexion, extension."},
          ]},
          {label:"Session B",day:"Combat + Glute/Ham",exercises:[
            {id:"t1b-wall-sit-prog",name:"Wall Sit — Progressed",equip:"Bodyweight",sets:3,reps:"6",hold:"30s",weight:"Bodyweight",rest:"90s",cue:"Same as Session A, but add a slight heel raise at the bottom to load calves simultaneously."},
            {id:"t1b-calf-iso-peak",name:"Calf Raise Iso — Peak",equip:"Single leg + DB",sets:3,reps:"6",hold:"30s",weight:"+20kg DB",rest:"90s",cue:"Rise onto toes and hold at the very top. Different loading zone from Session A mid-range."},
            {id:"t1b-wrist-ext",name:"Wrist Iso — Extension",equip:"Light band",sets:2,reps:"6",hold:"15s",weight:"Light band",rest:"45s",single:true,cue:"Forearm on a surface. Resist band pulling wrist into extension. Hold completely still."},
            {id:"t1b-wrist-flex",name:"Wrist Iso — Flexion",equip:"Light band",sets:2,reps:"6",hold:"15s",weight:"Light band",rest:"45s",single:true,cue:"Same position. Resist band pulling wrist into flexion. Separate set from extension."},
            {id:"t1b-glute-bridge",name:"Glute Bridge Hold",equip:"Bodyweight",sets:2,reps:"6",hold:"30s",weight:"Bodyweight",rest:"60s",cue:"Hips fully extended, shoulders on floor. Hold at top. Hamstring and glute tendon stimulus."},
          ]},
        ]},
      p2:{label:"Phase 2",weeks:"Weeks 5-8",name:"Heavy Slow",color:"#ff9f0a",
        meta:"Every rep: 4 seconds down, 1 second pause, 3 seconds up. The tempo is the stimulus — rushing defeats the purpose.",
        sessions:[
          {label:"Session A",day:"Calf, Quad, Hamstring",exercises:[
            {id:"t2a-sl-calf",name:"Single Leg Calf Raise",equip:"Dumbbell",sets:4,reps:"8",tempo:"4-1-3",weight:"+30-35kg DB",rest:"2 min",cue:"One leg only. Four seconds up, one second hold, three seconds down to full stretch. Full range. Use a rack for balance."},
            {id:"t2a-sissy-squat",name:"Slow Sissy Squat",equip:"Light added weight",sets:3,reps:"8",tempo:"4-1-3",weight:"BW +5kg",rest:"2 min",cue:"Hold something for balance. Lean back — knees travel far forward. Four seconds to max stretch, one pause, three up. True sissy pattern."},
            {id:"t2a-nordic",name:"Nordic Curl",equip:"Bodyweight",sets:3,reps:"6",tempo:"5s down",weight:"Bodyweight",rest:"2 min",cue:"Knees on padded surface, feet anchored. Lower as slowly as possible — five seconds or more. Catch with hands."},
            {id:"t2a-sl-rdl",name:"Single Leg RDL",equip:"Dumbbell",sets:2,reps:"10",tempo:"3-1-3",weight:"50-55kg",rest:"90s",cue:"Balance on one leg, hinge at hip, weight in opposite hand. Three seconds down to deep hamstring stretch."},
          ]},
          {label:"Session B",day:"Calf + Wrist",exercises:[
            {id:"t2b-sl-calf",name:"Single Leg Calf Raise B",equip:"Dumbbell",sets:4,reps:"8",tempo:"4-1-3",weight:"+30-35kg DB",rest:"2 min",cue:"Same as Session A. Emphasise extra time at the bottom stretch — pause a beat before driving up."},
            {id:"t2b-weighted-wall",name:"Weighted Wall Sit",equip:"Weight plate",sets:3,reps:"6",hold:"30s",weight:"+10kg plate",rest:"2 min",cue:"Phase 1 wall sit with a plate resting across your thighs. Hold 90 degrees."},
            {id:"t2b-slow-wrist",name:"Slow Wrist Curl",equip:"Dumbbell",sets:3,reps:"10",tempo:"3-1-3",weight:"7.5kg",rest:"60s",single:true,cue:"Forearm fully supported, palm up. Wrist only. Three seconds down, one second pause, three seconds up."},
            {id:"t2b-slow-rev-wrist",name:"Slow Reverse Wrist Curl",equip:"Dumbbell",sets:3,reps:"10",tempo:"3-1-3",weight:"5kg",rest:"60s",single:true,cue:"Overhand grip. Same tempo. Wrist extensor tendon — critical for combat wrist stability."},
          ]},
        ]},
      p3:{label:"Phase 3",weeks:"Weeks 9-12",name:"Plyometric",color:"#bf5af2",
        meta:"Ground contact time matters more than height. Target under 150ms per contact. All bodyweight. Quick, quiet landings.",
        sessions:[
          {label:"Session A",day:"Vertical + Reactive",exercises:[
            {id:"t3a-ankle-hops",name:"Ankle Hops",equip:"Bodyweight",sets:4,reps:"25",weight:"Bodyweight",rest:"90s",cue:"Minimal knee bend. Stiff ankles. Think the floor is hot — quick, quiet contacts. Balls of feet throughout."},
            {id:"t3a-pogo",name:"Pogo Jumps",equip:"Bodyweight",sets:4,reps:"20",weight:"Bodyweight",rest:"90s",cue:"Slightly higher than ankle hops. Stiff through ankle and knee. Spring-like — no collapse on landing."},
            {id:"t3a-depth-freeze",name:"Depth Drop to Freeze",equip:"Box 30-40cm",sets:3,reps:"6",weight:"Bodyweight",rest:"2 min",cue:"Step off the box — don't jump. Land and hold for two seconds. Build the landing before adding the jump."},
            {id:"t3a-depth-jump",name:"Depth Drop to Jump",equip:"Box 30-40cm",sets:3,reps:"6",weight:"Bodyweight",rest:"2 min",cue:"Step off, land, immediately explode up. Minimal ground contact. Stay stiff."},
            {id:"t3a-broad-jump",name:"Broad Jump",equip:"Bodyweight",sets:4,reps:"6",weight:"Bodyweight",rest:"2 min",cue:"Maximal horizontal jump. Drive arms. Land softly. Walk back between reps."},
          ]},
          {label:"Session B",day:"Horizontal + Combat",exercises:[
            {id:"t3b-sl-ankle",name:"Single Leg Ankle Hop",equip:"Bodyweight",sets:3,reps:"15 each",weight:"Bodyweight",rest:"90s",single:true,cue:"Progress from double-leg. If unstable, return to double first. Stiff ankle, quick contacts."},
            {id:"t3b-lat-bound",name:"Lateral Bound",equip:"Bodyweight",sets:3,reps:"8 each",weight:"Bodyweight",rest:"90s",single:true,cue:"Push laterally off one leg, land on the other, immediately bound back. Reactive landing."},
            {id:"t3b-cont-broad",name:"Continuous Broad Jump",equip:"Bodyweight",sets:3,reps:"5 in a row",weight:"Bodyweight",rest:"2 min",cue:"Land and immediately jump again — five consecutive jumps."},
            {id:"t3b-med-ball",name:"Rotational Med Ball Slam",equip:"Med ball",sets:3,reps:"8",weight:"5-8kg ball",rest:"90s",cue:"Full hip rotation — drive from the hips, not the arms. Wrist snap at release."},
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
    };

    // ── Shared Small Components ───────────────────────────────────────────────
    function WeightChip({exKey,defaultWeight,color,weights,onSave}) {
      const [editing,setEditing]=useState(false);
      const ref=useRef(null);
      const stored=weights[exKey];
      const val=stored!==undefined?stored:(defaultWeight||"");
      const [draft,setDraft]=useState(val);
      const startEdit=e=>{e.stopPropagation();setDraft(val);setEditing(true);setTimeout(()=>{if(ref.current){ref.current.focus();ref.current.select();}},50);};
      const commit=()=>{onSave(exKey,draft.trim());setEditing(false);};
      if(editing) return <input ref={ref} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} onClick={e=>e.stopPropagation()} placeholder="e.g. 35kg" style={{background:"var(--accent-muted)",border:"1.5px solid var(--accent)",borderRadius:"8px",color:"var(--text)",fontSize:"13px",fontWeight:"700",padding:"6px 10px",width:"85px",textAlign:"center"}}/>;
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
      if(editing) return <input ref={ref} value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} onClick={e=>e.stopPropagation()} placeholder="e.g. 10" style={{background:"var(--accent-muted)",border:"1.5px solid var(--accent)",borderRadius:"8px",color:"var(--text)",fontSize:"13px",fontWeight:"700",padding:"6px 10px",width:"75px",textAlign:"center"}}/>;
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
      const history = useMemo(() => getExerciseHistory(exerciseId).length > 0 ? getExerciseHistory(exerciseId) : getExerciseHistory(exerciseName), [exerciseId, exerciseName]);
      const best = getBestPerformance(exerciseId, exerciseName);
      return (
        <TapModal isOpen onClose={onClose}>
          <h3 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>{exerciseName}</h3>
          <p className="text-small" style={{marginBottom:"16px"}}>Exercise History</p>
          {best?.bestWeight && parseWeight(best.bestWeight.weight) > 0 && (
            <div style={{display:"flex",gap:"8px",marginBottom:"16px",flexWrap:"wrap"}}>
              <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>🏆 Max Weight:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{fmtWeight(best.bestWeight.weight)}</span></div>
              {best.bestReps && <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>🏆 Max Reps:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{best.bestReps.reps}</span></div>}
              {best.best1RM && <div className="session-badge" style={{borderColor:"var(--pr-gold)"}}><span>🏆 Est 1RM:</span><span className="font-bold" style={{color:"var(--pr-gold)"}}>{calc1RM(best.best1RM.weight, best.best1RM.reps)}kg</span></div>}
            </div>
          )}
          <ProgressionChart data={history} selectedExercise={exerciseName}/>
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

    function ProgressionChart({data,selectedExercise}) {
      const canvasRef=useRef(null);
      useEffect(()=>{
        if(!canvasRef.current||!data||data.length<2) return;
        const canvas=canvasRef.current;
        const ctx=canvas.getContext('2d');
        const rect=canvas.getBoundingClientRect();
        canvas.width=rect.width*2; canvas.height=rect.height*2; ctx.scale(2,2);
        const w=rect.width,h=rect.height,pad=35;
        const pts=data.map(d=>({date:new Date(d.date),weight:parseWeight(d.weight),label:d.weight||"0"})).sort((a,b)=>a.date-b.date);
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
      },[data,selectedExercise]);
      if(!data||data.length<2) return <div className="chart-container" style={{display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-secondary)",fontSize:"14px"}}>Complete this exercise twice to start tracking progression</div>;
      return <div className="chart-container"><canvas ref={canvasRef} className="chart-svg" style={{width:"100%",height:"100%"}}/></div>;
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
    function SessionPlayer({routineName,exercises,onFinish,onCancel,allWeights,allNotes}) {
      const [exIdx,setExIdx]=useState(0);
      const [mode,setMode]=useState("work");
      const [sessionPRs,setSessionPRs]=useState([]);
      const startTimeRef=useRef(Date.now());
      const [reorderMode,setReorderMode]=useState(false);
      const [exerciseOrder,setExerciseOrder]=useState(exercises.map((_,i)=>i));
      const orderedExercises = exerciseOrder.map(i => exercises[i]);

      // Set-by-set logging state
      const [setLogs,setSetLogs]=useState({}); // { "exIdx-setIdx": { weight, reps, seconds, logged, logId, prs } }
      const activeExRaw = orderedExercises[exIdx];
      const activeEx = activeExRaw || orderedExercises[0];
      const nextEx = exIdx+1<orderedExercises.length ? orderedExercises[exIdx+1] : null;
      const maxSets = activeEx?.sets || 1;
      const isTendonRoutine = routineName.includes("Tendon");
      const isStretchRoutine = routineName.startsWith("Stretching");

      // Current set tracking
      const [currentSetIdx, setCurrentSetIdx] = useState(0);

      // Side tracking for bilateral exercises
      const sideLabels = activeEx?.sideLabels || [];
      const hasSides = sideLabels.length > 0;
      const [currentSideIdx, setCurrentSideIdx] = useState(0);

      // Timer state
      const [targetSeconds,setTargetSeconds]=useState(90);
      const [remaining,setRemaining]=useState(90);
      const [isRunning,setIsRunning]=useState(false);
      const timerStartRef=useRef(0);
      const accRef=useRef(0);
      const rafRef=useRef(null);
      const [pendingAutoStart,setPendingAutoStart]=useState(null);
      const [isFinishedScreen,setIsFinishedScreen]=useState(false);
      // History of forward transitions — enables the ← Back button (with un-logging)
      const [historyStack,setHistoryStack]=useState([]);
      const pushHistory=()=>{
        setHistoryStack(p=>[...p,{exIdx,setIdx:currentSetIdx,mode,sideIdx:currentSideIdx}]);
      };
      const [skipModal,setSkipModal]=useState(false);
      // Last set of the last exercise → no point resting afterwards
      const isFinalStep = si => (exIdx+1>=orderedExercises.length) && ((si!==undefined?si:currentSetIdx)+1>=maxSets);

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
      const targetRef=useRef(targetSeconds);
      useEffect(()=>{targetRef.current=targetSeconds;},[targetSeconds]);

      // Get set key and current values
      const setKey = `${exIdx}-${currentSetIdx}`;
      const currentLog = setLogs[setKey] || {};
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
      const actualWeight = currentLog.weight !== undefined ? currentLog.weight : getSetWeight(currentSetIdx);
      const actualReps = currentLog.reps !== undefined ? currentLog.reps : getSetReps(currentSetIdx);
      const actualSeconds = currentLog.seconds !== undefined ? currentLog.seconds : (activeEx.hold ? String(parseInt(activeEx.hold.replace(/[^\d]/g,''))||30) : (activeEx.totalSec ? String(activeEx.totalSec) : ""));

      // Stats
      const totalSets = orderedExercises.reduce((a,e)=>a+(parseInt(e.sets)||1),0);
      const loggedSets = Object.values(setLogs).filter(l=>l.logged).length;
      const totalVolume = Object.values(setLogs).filter(l=>l.logged).reduce((acc, l) => acc + parseWeight(l.weight) * parseReps(l.reps), 0);
      const duration = Math.round((Date.now() - startTimeRef.current) / 60000);

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
            // Auto-log timed exercises
            if((activeEx.hold||activeEx.totalSec)&&!currentLog.logged){
              logSet(currentSetIdx);
            }
            if(activeEx.rest&&activeEx.rest!=="0s"&&!isFinalStep(currentSetIdx)){
              setPendingAutoStart("rest");
              setMode("rest");
            } else {
              setPendingAutoStart("work");
              advanceSet();
            }
          }
        } else if(m==="rest"){
          triggerSoundChecked('rest-chime');
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
        const w = setLogs[sk]?.weight !== undefined ? setLogs[sk].weight : getSetWeight(si);
        const r = setLogs[sk]?.reps !== undefined ? setLogs[sk].reps : getSetReps(si);
        const s = setLogs[sk]?.seconds !== undefined ? setLogs[sk].seconds : actualSeconds;

        // Check PRs
        const prs = checkForPRs(activeEx.id, activeEx.name, w, r);
        if (prs.length > 0 && !prs.includes('first')) {
          triggerSound('pr-fanfare');
          try { navigator.vibrate?.([50, 30, 50]); } catch {}
          setSessionPRs(prev => [...prev, { exercise: activeEx.name, exerciseId: activeEx.id, prs, weight: w, reps: r }]);
        }

        setSetLogs(p => ({...p, [sk]: { weight: w, reps: r, seconds: s, logged: true, logId, prs }}));
        // Save to progression
        const prog = store.get("workout_progression", []);
        prog.push({ id: logId, date: todayStr(), exercise: activeEx.name, exerciseId: activeEx.id, weight: w, reps: r, hold: s || "0", setNumber: si + 1 });
        store.set("workout_progression", prog);
      };

      const advanceSet = () => {
        setCurrentSideIdx(0);
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
          if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(si)) {
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
        if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(si)) {
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
        } else if (activeEx.rest && activeEx.rest !== "0s" && !isFinalStep(currentSetIdx)) {
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
          <div className="timer-overlay">
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
        return (
          <div className="timer-overlay" style={{justifyContent:"center",alignItems:"center",textAlign:"center",padding:"40px 24px"}}>
            <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",maxWidth:"400px",width:"100%"}}>
              <div style={{fontSize:"64px",marginBottom:"20px"}}>🎉</div>
              <h1 style={{fontSize:"30px",fontWeight:"900",lineHeight:"1.15",marginBottom:"8px"}}>Congratulations!</h1>
              <p style={{fontSize:"17px",color:"var(--text-secondary)",marginBottom:"24px"}}>You finished {routineName}!</p>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px",width:"100%",marginBottom:"16px"}}>
                <div className="card summary-stat"><div className="stat-value text-accent">{loggedSets}</div><div className="stat-label">Sets</div></div>
                <div className="card summary-stat"><div className="stat-value text-accent">{duration}</div><div className="stat-label">Minutes</div></div>
                <div className="card summary-stat"><div className="stat-value text-accent">{totalVolume > 0 ? `${Math.round(totalVolume).toLocaleString()}` : '—'}</div><div className="stat-label">Volume kg</div></div>
              </div>

              {sessionPRs.length > 0 && (
                <div className="card" style={{width:"100%",marginBottom:"16px",textAlign:"left"}}>
                  <p className="font-bold" style={{marginBottom:"8px"}}>🏆 New Personal Records</p>
                  {sessionPRs.map((pr, i) => (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:i < sessionPRs.length - 1 ? "0.5px solid var(--card-border)" : "none"}}>
                      <span className="font-bold" style={{fontSize:"14px"}}>{pr.exercise}</span>
                      <div style={{display:"flex",gap:"4px"}}>
                        {pr.prs.map(p => <span key={p} className="pr-badge">{p === 'weight' ? '🏋️ Weight' : p === 'reps' ? '🔁 Reps' : '📊 1RM'}</span>)}
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

      // ── Active Workout ──
      return (
        <div className="timer-overlay">
          <div className="flex-between" style={{width:"100%",marginBottom:"10px"}}>
            <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
              <div>
                <span className="badge" style={{marginLeft:"0"}}>{routineName}</span>
                <p className="text-small" style={{marginTop:"4px"}}>Ex {exIdx+1}/{orderedExercises.length} — Set {currentSetIdx+1}/{maxSets} — {loggedSets}/{totalSets} logged</p>
              </div>
            </div>
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",justifyContent:"flex-end"}}>
              {historyStack.length>0&&<button onClick={goBack} style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"6px 12px",fontSize:"13px",fontWeight:"800"}}>← Back</button>}
              <button onClick={() => setReorderMode(true)} style={{border:"1.5px solid var(--card-border)",borderRadius:"10px",padding:"6px 10px",fontSize:"12px",fontWeight:"700"}}>⇅</button>
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
              <div className="timer-circle-container" style={{width:"180px",height:"180px",margin:"20px auto"}}>
                <svg className="timer-circle-svg" viewBox="0 0 220 220">
                  <circle className="timer-circle-bg" cx="110" cy="110" r="100"/>
                  <circle className="timer-circle-progress" cx="110" cy="110" r="100" strokeDasharray="628" strokeDashoffset={strokeDashoffset}/>
                </svg>
                <div className="timer-display" style={{fontSize:"36px"}}><span>{fmtTime(remaining)}</span><span className="timer-label">{mode==="work"?"hold":"rest"}</span></div>
              </div>
            ):(
              mode==="work"&&<div style={{margin:"16px auto",textAlign:"center"}}>
                <div style={{fontSize:"40px",fontWeight:"900"}}>{activeEx.reps}</div>
                <div className="timer-label" style={{fontSize:"13px"}}>Target Reps{hasSides?" — each side":""}</div>
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
                      {!(activeEx.hold||activeEx.totalSec) && <th>Weight</th>}
                      {!(activeEx.hold||activeEx.totalSec) ? <th>Reps</th> : <th>Seconds</th>}
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
                      const isBW = !!(activeEx.equip&&/bodyweight|bw/i.test(activeEx.equip));
                      const sw = log.weight !== undefined ? log.weight : getSetWeight(si);
                      const sr = log.reps !== undefined ? log.reps : getSetReps(si);
                      const ss = log.seconds !== undefined ? log.seconds : actualSeconds;
                      return (
                        <tr key={si} className={isActive ? "active-set" : isDone ? "completed-set" : ""}>
                          <td style={{fontWeight:"700"}}>{si + 1}</td>
                          {!isHold && (
                            <td>
                              {isDone ? <span className="font-bold">{sw}</span> :
                                <input className="set-input" value={sw} onChange={e => updateSetLog(si, {weight: e.target.value})} placeholder="kg"/>}
                            </td>
                          )}
                          {!isHold ? (
                            <td>
                              {isDone ? <span className="font-bold">{sr}</span> :
                                <input className="set-input" value={sr} onChange={e => updateSetLog(si, {reps: e.target.value})} placeholder="reps" style={{width:"50px"}}/>}
                            </td>
                          ) : (
                            <td>
                              {isDone ? <span className="font-bold">{ss}s</span> :
                                <input className="set-input" value={ss} onChange={e => updateSetLog(si, {seconds: e.target.value})} placeholder="sec" style={{width:"50px"}}/>}
                            </td>
                          )}
                          <td>
                            <button className={`set-done-btn ${isDone ? 'done' : 'pending'}`} onClick={() => { if (!isDone) { setCurrentSetIdx(si); handleCompleteSet(si); } }}>
                              {isDone ? '✓' : '○'}
                            </button>
                            {log.prs && log.prs.length > 0 && !log.prs.includes('first') && <div className="pr-badge" style={{marginTop:"4px",fontSize:"9px"}}>🏆 PR</div>}
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
                <p className="text-small" style={{fontSize:"12px"}}>{nextEx.equip} — {nextEx.sets} set{nextEx.sets>1?"s":""} — {nextEx.reps||nextEx.hold}</p>
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

          {/* Skip choice modal */}
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
        saveW(workouts.map(s=>s.section===secName?{...s,exercises:[...s.exercises,{id:uid(),name:nm,equip:"Bodyweight",sets:1,reps:"10-12",rest:"90s",weight:"",cue:""}]}:s));
      };
      const launchSectionSession=sec=>{
        setActiveRoutine({name:`${sec.section} Workout`,exercises:sec.exercises.map(e=>withSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
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

      return (
        <div>
          {historyModal && <ExerciseHistoryModal exerciseId={historyModal.id} exerciseName={historyModal.name} onClose={() => setHistoryModal(null)}/>}
          <div className="card" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><h2 className="font-bold" style={{fontSize:"20px"}}>Strength & Hypertrophy</h2><p className="text-small">Progressive overload tracking</p></div>
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
              <p className="font-bold" style={{fontSize:"16px"}}>Full Body</p>
              <p className="text-small">{workoutSections.reduce((a,s)=>a+s.exercises.length,0)} exercises — all sections</p>
            </div>
            <button className="button-primary" style={{width:"auto",padding:"10px 20px",fontSize:"14px",background:accent,borderColor:accent}}
              onClick={()=>setActiveRoutine({name:"Full Body Workout",exercises:workoutSections.flatMap(s=>s.exercises.map(e=>withSides({...e,section:s.section,weight:weights[e.id||e.name]||e.weight||""})))})}>
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
                    {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                      <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>handleAddExercise(sec.section)}>+ Add Exercise</button>
                      <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>{
                        const v=prompt(`Rest time for ALL exercises in "${sec.section}" (e.g. 90s or 2 min):`);
                        if(!v)return;
                        saveW(workouts.map(s=>s.section===sec.section?{...s,exercises:s.exercises.map(e=>({...e,rest:v.trim()}))}:s));
                      }}>⏱ Rest for all</button>
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
      const [selectedPhase,setSelectedPhase]=useState("p1");
      const [editMode,setEditMode]=useState(false);
      const [checked,setChecked]=useState({});
      const [historyModal,setHistoryModal]=useState(null);
      const [tendonData,setTendonData]=useState(()=>store.get("tendon_custom",TENDON));
      const pd=tendonData[selectedPhase];
      const pdColor=tileColor||getThemeColor(pd.color,theme);
      const saveTendon=u=>{setTendonData(u);store.set("tendon_custom",u);};
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
        setActiveRoutine({name:`Tendon - ${pd.label} (${sess.label})`,exercises:sess.exercises.map(e=>withTendonSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
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
        <div>
          {historyModal && <ExerciseHistoryModal exerciseId={historyModal.id} exerciseName={historyModal.name} onClose={() => setHistoryModal(null)}/>}
          <div className="card" style={{padding:"8px",display:"flex",gap:"6px",marginBottom:"14px"}}>
            {Object.keys(tendonData).map(k=>{
              const btnColor=tileColor||getThemeColor(tendonData[k].color,theme);
              return <button key={k} onClick={()=>setSelectedPhase(k)} style={{flex:1,padding:"10px",borderRadius:"10px",background:selectedPhase===k?btnColor:"transparent",color:selectedPhase===k?"var(--btn-text)":"var(--text-secondary)",fontWeight:"700",fontSize:"13px"}}>{tendonData[k].label}</button>;
            })}
          </div>
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
                  <div key={exKey} className="flex-between" style={{padding:"8px 0",borderBottom:ei+1<sess.exercises.length?"0.5px solid var(--card-border)":"none",gap:"8px",alignItems:"flex-start"}}>
                    {editMode?(
                      <>
                        <div style={{display:"flex",flexDirection:"column",gap:"2px",flexShrink:0}}>
                          <button onClick={()=>moveEx(sess.label,ei,-1)} disabled={ei===0} style={{opacity:ei===0?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▲</button>
                          <button onClick={()=>moveEx(sess.label,ei,1)} disabled={ei===sess.exercises.length-1} style={{opacity:ei===sess.exercises.length-1?0.3:1,padding:"1px 5px",fontSize:"11px"}}>▼</button>
                        </div>
                        <div style={{flex:1,display:"flex",flexDirection:"column",gap:"5px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 44px 60px",gap:"5px",alignItems:"center"}}>
                            <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} value={ex.name} onChange={e=>updateEx(sess.label,ei,{name:e.target.value})}/>
                            <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} type="number" min="1" value={ex.sets} onChange={e=>updateEx(sess.label,ei,{sets:parseInt(e.target.value)||1})}/>
                            <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px"}} value={ex.hold||ex.reps||""} onChange={e=>updateEx(sess.label,ei,{hold:e.target.value,reps:e.target.value})}/>
                          </div>
                          <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
                            <span className="text-small" style={{fontSize:"10px",textTransform:"uppercase",fontWeight:"700"}}>Rest</span>
                            <input className="field" style={{marginBottom:0,fontSize:"13px",padding:"6px",width:"72px"}} value={ex.rest||""} placeholder="90s" onChange={e=>updateEx(sess.label,ei,{rest:e.target.value})}/>
                            <SideToggle ex={ex} detector={withTendonSides} onChange={v=>updateEx(sess.label,ei,{unilateral:v})}/>
                          </div>
                        </div>
                        <button onClick={()=>deleteEx(sess.label,exKey)} style={{width:"30px",height:"30px",flexShrink:0,borderRadius:"50%",background:"var(--danger-muted)",color:"var(--danger)",fontSize:"16px",fontWeight:"900"}}>×</button>
                      </>
                    ):(
                      <>
                        <button className={`custom-tick ${checked[exKey]?"checked":""}`} onClick={()=>setChecked(p=>({...p,[exKey]:!p[exKey]}))} style={{marginTop:"4px"}}>  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--btn-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg></button>
                        <div style={{flex:1,minWidth:0}}>
                          <Editable as="p" className="font-bold" style={{fontSize:"14px"}} value={ex.name} onSave={t=>updateEx(sess.label,ei,{name:t})} singleAction={()=>setHistoryModal({id:exKey,name:ex.name})}/>
                          <p className="text-small" style={{fontSize:"11px"}}>{ex.equip} — {ex.sets} sets — Hold {ex.hold}
                            {tendonExHasSides(ex)&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>L+R</span>}
                          </p>
                          <PreviousPerformanceBanner exerciseId={exKey} exerciseName={ex.name} compact/>
                          <Editable as="p" multiline className="text-small" style={{fontSize:"12px",marginTop:"4px",fontStyle:"italic",opacity:0.85,lineHeight:"1.35"}} value={ex.cue||""} placeholder="Double-tap to add cue…" onSave={t=>updateEx(sess.label,ei,{cue:t})}/>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:"4px",alignItems:"center",flexShrink:0}}>
                          <ExerciseNoteButton exerciseId={exKey} notes={notes} onSave={saveNote}/>
                          <WeightChip exKey={exKey} defaultWeight={ex.weight} color={pdColor} weights={weights} onSave={saveWeight}/>
                        </div>
                      </>
                    )}
                  </div>
                );})}
                {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"10px"}}>
                  <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>addEx(sess.label)}>+ Add Exercise</button>
                  <button className="button-secondary" style={{padding:"8px",fontSize:"13px"}} onClick={()=>{
                    const v=prompt(`Rest time for ALL exercises in "${sess.label}" (e.g. 90s or 2 min):`);
                    if(!v)return;
                    saveTendon({...tendonData,[selectedPhase]:{...pd,sessions:pd.sessions.map(s=>s.label===sess.label?{...s,exercises:s.exercises.map(e=>({...e,rest:v.trim()}))}:s)}});
                  }}>⏱ Rest for all</button>
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
        setActiveRoutine({name:`Stretching Phase ${selectedPhase} - ${phaseData.name}`,exercises:stretchList.map(s=>withSides({...s,sets:1,hold:`${s.totalSec}s`,rest:rs>0?`${rs}s`:"0s",cue:getStretchCue(s,selectedPhase)}))});
      };
      return (
        <div>
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
      const filtered = trackedPts.filter(p => p.exercise === selectedEx);
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
          <div className="card"><h2 className="font-bold" style={{fontSize:"20px"}}>Progression</h2><p className="text-small">Weight and hold tracking over time</p></div>
          {uniqueEx.length===0?(
            <div className="card" style={{textAlign:"center",padding:"40px 20px",color:"var(--text-secondary)"}}>Complete sets inside Workouts or Tendons to start tracking.</div>
          ):(
            <div>
              <div className="card">
                <label className="field-label">Exercise</label>
                <select className="field" value={selectedEx} onChange={e=>setSelectedEx(e.target.value)} style={{background:"var(--input-bg)",cursor:"pointer"}}>
                  {uniqueEx.map((ue,i)=><option key={i} value={ue}>{ue}</option>)}
                </select>
                <h3 className="font-bold" style={{fontSize:"15px",marginTop:"14px"}}>Progression Curve</h3>
                <ProgressionChart data={filtered} selectedExercise={selectedEx}/>
              </div>
              <div className="card">
                <h3 className="font-bold" style={{fontSize:"15px",marginBottom:"10px"}}>Log History</h3>
                {[...filtered].reverse().map((l,i)=>(
                  <div key={i} className="progression-item" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px"}}>
                    <div style={{flex:1,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>{l.date}{l.setNumber ? ` (Set ${l.setNumber})` : ''}</span>
                      <span className="font-bold text-accent">{l.weight||"BW"}{l.reps?` · ${l.reps} reps`:""}{l.hold&&l.hold!=="0"?` · ${l.hold}`:""}</span>
                    </div>
                    <button onClick={() => handleDeleteSet(l.id)} style={{color:"var(--danger)",background:"var(--danger-muted)",width:"22px",height:"22px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"14px",fontWeight:"900"}}>×</button>
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

    function SplitBuilderModal({onSave,onClose}) {
      const [phaseCount,setPhaseCount]=useState("1");
      const [exerciseCount,setExerciseCount]=useState("3");
      const n=Math.max(1,Math.min(20,parseInt(exerciseCount)||1));
      const save=()=>{
        const pCount=Math.max(1,Math.min(8,parseInt(phaseCount)||1));
        const phases=Array.from({length:pCount},(_,i)=>`Phase ${i+1}`);
        const exercises=Array.from({length:n},(_,i)=>({id:uid(),name:`Exercise ${i+1}`,equip:"Bodyweight",sets:1,reps:"8-12",hold:"",rest:"90s",weight:"",cue:""}));
        onSave({id:uid(),section:"New Split",description:"",phases,exercises});
      };
      return (
        <TapModal isOpen onClose={onClose}>
          <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>Create Split</h2>
          <p className="text-small" style={{marginBottom:"16px"}}>Choose structure first. Add details in Edit mode.</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
            <div><label className="field-label">Phases</label><input className="field" type="number" min="1" max="8" value={phaseCount} onChange={e=>setPhaseCount(e.target.value)}/></div>
            <div><label className="field-label">Exercises</label><input className="field" type="number" min="1" max="20" value={exerciseCount} onChange={e=>setExerciseCount(e.target.value)}/></div>
          </div>
          <button className="button-primary" onClick={save}>Create Split</button>
          <button className="button-secondary" style={{marginTop:"10px"}} onClick={onClose}>Cancel</button>
        </TapModal>
      );
    }

    function CustomSplitTab({split,setWorkouts,weights,saveWeight,setActiveRoutine,notes,saveNote,tileColor}) {
      const [editMode,setEditMode]=useState(false);
      const [phaseIdx,setPhaseIdx]=useState(0);
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
      const launch=()=>setActiveRoutine({name:`${split.section} Workout`,exercises:split.exercises.map(e=>withSides({...e,weight:weights[e.id||e.name]||e.weight||""}))});
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
        <div>
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
                      </div>
                    </div>
                  </div>
                ):(
                  <div style={{flex:1}}>
                    <Editable as="p" className="font-bold" value={ex.name} onSave={t=>updateExercise(i,{name:t})}/>
                    <p className="text-small">{ex.sets} sets — {ex.reps||ex.hold}
                      {exerciseHasSides(ex)&&<span className="badge" style={{fontSize:"9px",marginLeft:"4px"}}>L+R</span>}
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
            {editMode&&<div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
              <button className="button-secondary" onClick={addExercise}>+ Add Exercise</button>
              <button className="button-secondary" onClick={()=>{
                const v=prompt("Rest time for ALL exercises in this split (e.g. 90s or 2 min):");
                if(!v)return;
                saveSplit({exercises:split.exercises.map(e=>({...e,rest:v.trim()}))});
              }}>⏱ Rest for all</button>
            </div>}
          </div>
        </div>
      );
    }

    // ── App ────────────────────────────────────────────────────────────────────
    function App() {
      const [activeTab,setActiveTab]=useState("home");
      const [theme,setTheme]=useState(()=>{
        const t=store.get("workout_theme","dark");
        document.documentElement.setAttribute('data-theme',t);
        return t;
      });
      const [username,setUsername]=useState(()=>store.get("workout_username","Abiram"));
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
      const tileLabelFor=(id,fallback)=>(tileMeta[id]||{}).label||fallback;
      const [workouts,setWorkouts]=useState(()=>store.get("workout_sections_custom",FB_SECTIONS));
      const saveReps=(k,v)=>{const u={...customReps,[k]:v};setCustomReps(u);store.set("workout_reps",u);};
      const saveNote=(k,v)=>{const u={...notes,[k]:v};if(!v)delete u[k];setNotes(u);store.set("workout_notes",u);};
      const [logs,setLogs]=useState(()=>store.get("workout_logs",[]));
      const [counts,setCounts]=useState(()=>store.get("workout_completed_counts",{workouts:0,tendons:0,stretches:0}));
      const [activeRoutine,setActiveRoutine]=useState(null);
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
        const homeTiles=[
          !hiddenTabs.includes("workouts")&&{id:"workouts",label:"Workouts",Icon:Icons.Dumbbell,color:"var(--success)"},
          !hiddenTabs.includes("tendons")&&{id:"tendons",label:"Tendon",Icon:Icons.Tendon,color:"var(--danger)"},
          !hiddenTabs.includes("stretches")&&{id:"stretches",label:"Stretch",Icon:Icons.Stretch,color:"#0a84ff"},
          ...workouts.filter(s=>s.description!==undefined||s.phases).map(s=>({id:s.id||s.section,label:s.section,Icon:Icons.Dumbbell,color:"var(--accent)",custom:true})),
        ].filter(Boolean);
        return (
          <div>
            <div style={{padding:"18px 0 22px",borderBottom:"1px solid var(--card-border)",marginBottom:"18px"}}>
              <p style={{fontSize:"13px",fontWeight:"800",color:"var(--text-secondary)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"14px"}}>Workout</p>
              {editingName?(
                <input className="field" autoFocus value={username} onChange={e=>{setUsername(e.target.value);store.set("workout_username",e.target.value);}} onBlur={()=>setEditingName(false)} onKeyDown={e=>{if(e.key==="Enter")setEditingName(false)}}/>
              ):(
                <button onClick={()=>setEditingName(true)} style={{textAlign:"left",display:"block"}}>
                  <h1 style={{fontSize:"40px",lineHeight:"1.05",fontWeight:"900"}}>Hi, {username||"Abiram"}.</h1>
                  <p className="text-small" style={{fontSize:"17px",marginTop:"8px"}}>Tap name to edit · Long-press tiles to rename</p>
                </button>
              )}
            </div>

            {/* Streak Card */}
            {(streaks.current > 0 || streaks.longest > 0) && (
              <div className="card streak-card">
                <div style={{display:"flex",gap:"24px",position:"relative",zIndex:1}}>
                  <div>
                    <p className="text-small font-bold" style={{textTransform:"uppercase",fontSize:"10px",letterSpacing:"0.08em"}}>Current Streak</p>
                    <p style={{fontSize:"28px",fontWeight:"900",color:"var(--warning)",lineHeight:"1.1"}}>{streaks.current} <span style={{fontSize:"14px",fontWeight:"600"}}>days</span></p>
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

            {/* Import Split Button */}
            <button className="button-secondary" style={{marginBottom:"16px",padding:"10px",fontSize:"13px"}} onClick={()=>setImportModal(true)}>📥 Import Split from JSON</button>

            <div className="card">
              <h2 className="font-bold" style={{fontSize:"20px",marginBottom:"4px"}}>Training Log</h2>
              <p className="text-small">Strength, tendon, and mobility tracking</p>
              <div className="badge-bar" style={{marginTop:"16px"}}>
                <div className="session-badge"><span>Workouts:</span><span className="text-accent font-bold">{counts.workouts}</span></div>
                <div className="session-badge"><span>Tendon:</span><span className="text-accent font-bold">{counts.tendons}</span></div>
                <div className="session-badge"><span>Stretches:</span><span className="text-accent font-bold">{counts.stretches}</span></div>
              </div>
            </div>
            <div className="card">
              <h3 className="font-bold" style={{fontSize:"16px"}}>30-Day Grid</h3>
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
            <SoundConfigCard/>
            <TimerConfigCard/>
            <WakeLockToggle/>
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
          return <SplitBuilderModal onSave={addSplit} onClose={()=>setModalContent(null)}/>;
        }
        return null;
      };

      return (
        <div>
          <header>
            <div className="app-title font-bold text-accent">WORKOUT</div>
            <button onClick={cycleTheme} style={{border:"1.5px solid var(--card-border)",borderRadius:"20px",padding:"6px 14px",fontSize:"12px",fontWeight:"700",textTransform:"uppercase"}}>
              {theme}
            </button>
          </header>

          {activeRoutine&&(
            <SessionPlayer routineName={activeRoutine.name} exercises={activeRoutine.exercises}
              onFinish={()=>{setActiveRoutine(null);reloadLogs();}}
              onCancel={()=>setActiveRoutine(null)}
              allWeights={weights}
              allNotes={notes}/>
          )}

          <div className="container">
            {activeTab==="home"&&renderHome()}
            {activeTab==="workouts"&&<WorkoutsTab workouts={workouts} setWorkouts={setWorkouts} weights={weights} saveWeight={saveWeight} customReps={customReps} saveReps={saveReps} counts={counts} setActiveRoutine={setActiveRoutine} setModalContent={setModalContent} reloadLogs={reloadLogs} theme={theme} notes={notes} saveNote={saveNote} tileColor={tileColorFor("workouts")}/>}
            {activeTab==="tendons"&&<TendonsTab weights={weights} saveWeight={saveWeight} counts={counts} setActiveRoutine={setActiveRoutine} theme={theme} reloadLogs={reloadLogs} notes={notes} saveNote={saveNote} tileColor={tileColorFor("tendons")}/>}
            {activeTab==="stretches"&&<StretchesTab counts={counts} setActiveRoutine={setActiveRoutine} theme={theme} reloadLogs={reloadLogs} tileColor={tileColorFor("stretches")}/>}
            {activeTab==="progression"&&<ProgressionTab reloadLogs={reloadLogs}/>}
            {activeCustomSplit&&<CustomSplitTab split={activeCustomSplit} setWorkouts={setWorkouts} weights={weights} saveWeight={saveWeight} setActiveRoutine={setActiveRoutine} notes={notes} saveNote={saveNote} tileColor={tileColorFor(activeCustomSplit.id||activeCustomSplit.section)}/>}
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
            {[{id:"home",label:"Home",Icon:Icons.Home},{id:"workouts",label:tileLabelFor("workouts","Workouts"),Icon:Icons.Dumbbell},{id:"tendons",label:tileLabelFor("tendons","Tendons"),Icon:Icons.Tendon},{id:"stretches",label:tileLabelFor("stretches","Stretch"),Icon:Icons.Stretch},{id:"progression",label:"Progress",Icon:Icons.Chart},...customSplits.map(s=>({id:`split-${s.id||s.section}`,label:tileLabelFor(s.id||s.section,s.section),Icon:Icons.Dumbbell}))].filter(t=>t.id==="home"||t.id==="progression"||t.id.startsWith("split-")||!hiddenTabs.includes(t.id)).map(({id,label,Icon})=>(
              <button key={id} className={`tab-btn ${activeTab===id?"active":""}`} style={{width:"auto",flex:"1 1 0",minWidth:"48px"}} onClick={()=>setActiveTab(id)}>
                <Icon/><span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
