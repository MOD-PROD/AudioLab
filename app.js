// ═══════════════════════════════════════════════════════════════
//  AudioLab Pro — Shared JS Engine v3.2.0
//  Web Audio API mastering engine shared by portrait + landscape
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── STATE ──────────────────────────────────────────────────────
let audioCtx = null;
let audioBuffer = null;
let sourceNode = null;
let isPlaying = false;
let playbackOffset = 0;
let startTime = 0;
let isDry = false;
let animFrameId = null;
let nodes = {};
let lufsBuffer = [];
let analysisData = null;
let activePreset = null;

const specC  = () => document.getElementById('specCanvas');
const scopeC = () => document.getElementById('scopeCanvas');

// ── HELPERS ────────────────────────────────────────────────────
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function $ (id) { return document.getElementById(id); }
function set(id, v) { const el = $(id); if (el) el.textContent = v; }

function showToast(msg) {
  let t = $('global-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'global-toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── ORIENTATION GUARD (portrait only) ──────────────────────────
function checkLandscape() {
  if (document.body.classList.contains('portrait-only')) {
    if (window.matchMedia('(orientation: landscape)').matches || window.innerWidth > window.innerHeight) {
      window.location.replace('index-landscape.html');
    }
  }
}

// ── CANVAS RESIZE ──────────────────────────────────────────────
function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  [specC(), scopeC()].forEach(c => {
    if (!c) return;
    c.width  = c.offsetWidth  * dpr;
    c.height = c.offsetHeight * dpr;
  });
}

// ── AUDIO ENGINE INIT ──────────────────────────────────────────
function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();

  nodes.input = audioCtx.createGain();
  nodes.dry   = audioCtx.createGain();
  nodes.wet   = audioCtx.createGain();

  // EQ
  nodes.low  = audioCtx.createBiquadFilter(); nodes.low.type  = 'lowshelf';  nodes.low.frequency.value  = 250;
  nodes.mid  = audioCtx.createBiquadFilter(); nodes.mid.type  = 'peaking';   nodes.mid.frequency.value  = 1200; nodes.mid.Q.value = 0.7;
  nodes.high = audioCtx.createBiquadFilter(); nodes.high.type = 'highshelf'; nodes.high.frequency.value = 6500;

  // Saturation
  nodes.shaper     = audioCtx.createWaveShaper();
  nodes.shaperGain = audioCtx.createGain();

  // Dynamics
  nodes.comp    = audioCtx.createDynamicsCompressor();
  nodes.comp.attack.value   = 0.01;
  nodes.comp.release.value  = 0.1;
  nodes.comp.knee.value     = 6;

  nodes.lookAheadDelay = audioCtx.createDelay(0.02);
  nodes.lookAheadDelay.delayTime.value = 0.005;

  nodes.limiter = audioCtx.createDynamicsCompressor();
  nodes.limiter.ratio.value   = 20;
  nodes.limiter.attack.value  = 0.003;
  nodes.limiter.release.value = 0.05;
  nodes.limiter.knee.value    = 0;

  // Mid/Side matrix
  const k = 1 / Math.sqrt(2);
  nodes.splitter = audioCtx.createChannelSplitter(2);
  nodes.merger   = audioCtx.createChannelMerger(2);
  nodes.lToMid   = audioCtx.createGain(); nodes.lToMid.gain.value  =  k;
  nodes.rToMid   = audioCtx.createGain(); nodes.rToMid.gain.value  =  k;
  nodes.lToSide  = audioCtx.createGain(); nodes.lToSide.gain.value =  k;
  nodes.rToSide  = audioCtx.createGain(); nodes.rToSide.gain.value = -k;
  nodes.midGain  = audioCtx.createGain(); nodes.midGain.gain.value  = 1;
  nodes.sideGain = audioCtx.createGain(); nodes.sideGain.gain.value = 1;
  nodes.midToL   = audioCtx.createGain(); nodes.midToL.gain.value  =  1;
  nodes.midToR   = audioCtx.createGain(); nodes.midToR.gain.value  =  1;
  nodes.sideToL  = audioCtx.createGain(); nodes.sideToL.gain.value =  1;
  nodes.sideToR  = audioCtx.createGain(); nodes.sideToR.gain.value = -1;

  // Reverb
  nodes.reverb    = audioCtx.createConvolver();
  nodes.reverbGain = audioCtx.createGain();
  nodes.reverbDry  = audioCtx.createGain();

  // Master + Analyser
  nodes.master   = audioCtx.createGain();
  nodes.analyser = audioCtx.createAnalyser(); nodes.analyser.fftSize = 1024;

  // K-weighted LUFS metering (BS.1770-4)
  nodes.lufsGain      = audioCtx.createGain();
  nodes.lufsSplitter  = audioCtx.createChannelSplitter(2);
  nodes.kL1 = audioCtx.createBiquadFilter(); nodes.kL1.type='highshelf'; nodes.kL1.frequency.value=1681; nodes.kL1.gain.value=3.999; nodes.kL1.Q.value=0.7071;
  nodes.kL2 = audioCtx.createBiquadFilter(); nodes.kL2.type='highpass';  nodes.kL2.frequency.value=38.13; nodes.kL2.Q.value=0.5;
  nodes.kR1 = audioCtx.createBiquadFilter(); nodes.kR1.type='highshelf'; nodes.kR1.frequency.value=1681; nodes.kR1.gain.value=3.999; nodes.kR1.Q.value=0.7071;
  nodes.kR2 = audioCtx.createBiquadFilter(); nodes.kR2.type='highpass';  nodes.kR2.frequency.value=38.13; nodes.kR2.Q.value=0.5;
  nodes.lufsAnalyserL = audioCtx.createAnalyser(); nodes.lufsAnalyserL.fftSize = 256;
  nodes.lufsAnalyserR = audioCtx.createAnalyser(); nodes.lufsAnalyserR.fftSize = 256;

  // Signal routing
  nodes.input.connect(nodes.dry);
  nodes.input.connect(nodes.shaper);
  nodes.shaper.connect(nodes.shaperGain);
  nodes.shaperGain.connect(nodes.low);
  nodes.low.connect(nodes.mid);
  nodes.mid.connect(nodes.high);
  nodes.high.connect(nodes.comp);
  nodes.comp.connect(nodes.lookAheadDelay);
  nodes.lookAheadDelay.connect(nodes.limiter);
  nodes.limiter.connect(nodes.splitter);

  nodes.splitter.connect(nodes.lToMid, 0);  nodes.splitter.connect(nodes.rToMid, 1);
  nodes.splitter.connect(nodes.lToSide, 0); nodes.splitter.connect(nodes.rToSide, 1);
  nodes.lToMid.connect(nodes.midGain);  nodes.rToMid.connect(nodes.midGain);
  nodes.lToSide.connect(nodes.sideGain); nodes.rToSide.connect(nodes.sideGain);
  nodes.midGain.connect(nodes.midToL);  nodes.midGain.connect(nodes.midToR);
  nodes.sideGain.connect(nodes.sideToL); nodes.sideGain.connect(nodes.sideToR);
  nodes.midToL.connect(nodes.merger, 0, 0); nodes.midToR.connect(nodes.merger, 0, 1);
  nodes.sideToL.connect(nodes.merger, 0, 0); nodes.sideToR.connect(nodes.merger, 0, 1);

  nodes.merger.connect(nodes.reverbDry);
  nodes.merger.connect(nodes.reverb);
  nodes.reverb.connect(nodes.reverbGain);
  nodes.reverbGain.connect(nodes.wet);
  nodes.reverbDry.connect(nodes.wet);
  nodes.dry.connect(nodes.master);
  nodes.wet.connect(nodes.master);
  nodes.master.connect(nodes.analyser);
  nodes.analyser.connect(audioCtx.destination);

  nodes.master.connect(nodes.lufsGain);
  nodes.lufsGain.connect(nodes.lufsSplitter);
  nodes.lufsSplitter.connect(nodes.kL1, 0); nodes.kL1.connect(nodes.kL2); nodes.kL2.connect(nodes.lufsAnalyserL);
  nodes.lufsSplitter.connect(nodes.kR1, 1); nodes.kR1.connect(nodes.kR2); nodes.kR2.connect(nodes.lufsAnalyserR);

  updateReverbImpulse();
  updateAll();
}

// ── REVERB ─────────────────────────────────────────────────────
function updateReverbImpulse() {
  if (!audioCtx) return;
  const decay = parseFloat($('p-decay').value);
  const sr = audioCtx.sampleRate;
  const preLen  = Math.ceil(sr * 0.02);
  const tailLen = Math.ceil(sr * decay);
  const buf = audioCtx.createBuffer(2, preLen + tailLen, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    [0.005,0.010,0.013,0.016,0.019,0.022].forEach((t, i) => {
      const idx = Math.floor(t * sr);
      if (idx < preLen + tailLen) d[idx] = (c === 0 ? 1 : -1) * [0.7,0.5,0.4,0.3,0.22,0.15][i];
    });
    let lp = 0;
    for (let i = preLen; i < preLen + tailLen; i++) {
      const age = (i - preLen) / tailLen;
      const env = Math.pow(1 - age, decay * 0.5) * Math.exp(-age * decay * 0.8);
      lp = lp * 0.65 + (Math.random() * 2 - 1) * 0.35;
      d[i] = lp * env * (c === 0 ? 1 : 1 + (Math.random() - 0.5) * 0.04);
    }
  }
  nodes.reverb.buffer = buf;
}

// ── WARMTH ─────────────────────────────────────────────────────
function makeWarmthCurve(amount) {
  const k = Math.max(0.0001, amount / 30);
  const n = 256, c = new Float32Array(n), tK = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(k * x) / tK; }
  return c;
}

// ── PARAMETER UPDATE ───────────────────────────────────────────
function updateAll() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  nodes.low.gain.setTargetAtTime(parseFloat($('p-low').value), t, 0.03);
  nodes.mid.frequency.setTargetAtTime(parseFloat($('p-midfreq').value), t, 0.03);
  nodes.mid.gain.setTargetAtTime(parseFloat($('p-mid').value), t, 0.03);
  nodes.mid.Q.setTargetAtTime(parseFloat($('p-midq').value), t, 0.03);
  nodes.high.gain.setTargetAtTime(parseFloat($('p-high').value), t, 0.03);
  const warmth = parseFloat($('p-warmth').value);
  nodes.shaper.curve = makeWarmthCurve(warmth);
  nodes.shaperGain.gain.setTargetAtTime(1 + warmth / 120, t, 0.05);
  nodes.comp.threshold.setTargetAtTime(parseFloat($('p-thresh').value), t, 0.05);
  nodes.comp.ratio.setTargetAtTime(parseFloat($('p-ratio').value), t, 0.05);
  nodes.limiter.threshold.setTargetAtTime(parseFloat($('p-limit').value), t, 0.05);
  nodes.sideGain.gain.setTargetAtTime(parseFloat($('p-width').value) / 100, t, 0.05);
  const mix = parseFloat($('p-reverb').value) / 100;
  nodes.reverbGain.gain.setTargetAtTime(mix, t, 0.05);
  nodes.reverbDry.gain.setTargetAtTime(1 - mix, t, 0.05);
  nodes.master.gain.setTargetAtTime(Math.pow(10, parseFloat($('p-gain').value) / 20), t, 0.03);
  updateMix();
}

function updateMix() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  nodes.dry.gain.setTargetAtTime(isDry ? 1 : 0, t, 0.05);
  nodes.wet.gain.setTargetAtTime(isDry ? 0 : 1, t, 0.05);
}

// ── SLIDERS ────────────────────────────────────────────────────
const SLIDER_DEFS = [
  { id:'p-low',     dsp:'v-low',     fmt: v => v.toFixed(1) + ' dB' },
  { id:'p-midfreq', dsp:'v-midfreq', fmt: v => v >= 1000 ? (v/1000).toFixed(1) + ' kHz' : Math.round(v) + ' Hz' },
  { id:'p-mid',     dsp:'v-mid',     fmt: v => v.toFixed(1) + ' dB' },
  { id:'p-midq',    dsp:'v-midq',    fmt: v => v.toFixed(1) },
  { id:'p-high',    dsp:'v-high',    fmt: v => v.toFixed(1) + ' dB' },
  { id:'p-warmth',  dsp:'v-warmth',  fmt: v => Math.round(v) + '%' },
  { id:'p-thresh',  dsp:'v-thresh',  fmt: v => Math.round(v) + ' dB' },
  { id:'p-ratio',   dsp:'v-ratio',   fmt: v => v.toFixed(1) + ':1' },
  { id:'p-limit',   dsp:'v-limit',   fmt: v => v.toFixed(1) + ' dB' },
  { id:'p-width',   dsp:'v-width',   fmt: v => Math.round(v) + '%' },
  { id:'p-reverb',  dsp:'v-reverb',  fmt: v => Math.round(v) + '%' },
  { id:'p-decay',   dsp:'v-decay',   fmt: v => v.toFixed(1) + 's' },
  { id:'p-gain',    dsp:'v-gain',    fmt: v => v.toFixed(1) + ' dB' },
];

function initSliders() {
  SLIDER_DEFS.forEach(({ id, dsp, fmt }) => {
    const el = $(id), out = $(dsp);
    if (!el) return;
    if (out) out.textContent = fmt(parseFloat(el.value));
    el.addEventListener('input', () => {
      if (out) out.textContent = fmt(parseFloat(el.value));
      if (id === 'p-decay') updateReverbImpulse();
      if (audioCtx) updateAll();
    });
  });
}

// ── PROGRESS BAR ───────────────────────────────────────────────
function updateProgress() {
  if (!audioBuffer || !isPlaying) return;
  const elapsed = (audioCtx.currentTime - startTime) + playbackOffset;
  const pct = Math.min(100, (elapsed / audioBuffer.duration) * 100);
  $('progressFill').style.width = pct + '%';
  $('t-current').textContent = fmtTime(elapsed);
}

function initProgressBar() {
  const bar = $('progressBar');
  if (!bar) return;
  bar.addEventListener('click', function(e) {
    if (!audioBuffer) return;
    const rect = this.getBoundingClientRect();
    const seekTo = ((e.clientX - rect.left) / rect.width) * audioBuffer.duration;
    if (isPlaying) {
      if (sourceNode) { sourceNode.onended = null; try { sourceNode.stop(); } catch(_) {} }
      playbackOffset = seekTo;
      startTime = audioCtx.currentTime;
      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(nodes.input);
      sourceNode.start(0, Math.max(0, seekTo));
      sourceNode.onended = onEnded;
    } else {
      playbackOffset = seekTo;
      $('progressFill').style.width = Math.min(100, (seekTo / audioBuffer.duration) * 100) + '%';
      $('t-current').textContent = fmtTime(seekTo);
    }
  });
}

// ── FILE LOADING ────────────────────────────────────────────────
function initFileInput() {
  const input = $('audioInput');
  if (!input) return;
  input.addEventListener('change', async function(e) {
    const file = e.target.files[0]; if (!file) return;
    if (sourceNode) { sourceNode.onended = null; try { sourceNode.stop(); } catch(_) {} sourceNode = null; }
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    isPlaying = false; playbackOffset = 0; lufsBuffer = [];
    $('playBtn').textContent = 'Play';
    $('progressFill').style.width = '0%';
    $('t-current').textContent = '0:00';
    const fnEl = $('fileName');
    fnEl.textContent = file.name.toUpperCase().slice(0, 28);
    fnEl.style.color = '';
    initAudio();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    try {
      const buf = await audioCtx.decodeAudioData((await file.arrayBuffer()).slice(0));
      audioBuffer = buf;
      set('t-format',   file.name.split('.').pop().toUpperCase());
      set('t-rate',     (buf.sampleRate / 1000).toFixed(1) + ' kHz');
      set('t-channels', buf.numberOfChannels === 2 ? 'STEREO' : 'MONO');
      set('t-duration', fmtTime(buf.duration));
      set('t-total',    fmtTime(buf.duration));
      $('playBtn').disabled   = false;
      $('stopBtn').disabled   = false;
      $('exportBtn').disabled = false;
      const sig = $('l-signal'); if (sig) sig.classList.add('on');
      runFullAnalysis(buf);
    } catch(err) {
      console.error('Decode error:', err);
      fnEl.textContent = '⚠ Format non supporté';
      fnEl.style.color = '#ff4444';
    }
  });
}

// ── TRANSPORT ──────────────────────────────────────────────────
function onEnded() {
  isPlaying = false; playbackOffset = 0; lufsBuffer = [];
  $('playBtn').textContent = 'Play';
  $('progressFill').style.width = '0%';
  $('t-current').textContent = '0:00';
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

function initTransport() {
  $('playBtn').addEventListener('click', () => {
    if (!audioBuffer) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (isPlaying) {
      try { sourceNode.stop(); } catch(_) {}
      playbackOffset += audioCtx.currentTime - startTime;
      isPlaying = false;
      $('playBtn').textContent = 'Play';
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    } else {
      sourceNode = audioCtx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(nodes.input);
      startTime = audioCtx.currentTime;
      sourceNode.start(0, Math.max(0, playbackOffset % audioBuffer.duration));
      sourceNode.onended = onEnded;
      isPlaying = true;
      $('playBtn').textContent = 'Pause';
      drawLoop();
    }
  });

  $('stopBtn').addEventListener('click', () => {
    if (sourceNode) { sourceNode.onended = null; try { sourceNode.stop(); } catch(_) {} sourceNode = null; }
    isPlaying = false; playbackOffset = 0; lufsBuffer = [];
    $('playBtn').textContent = 'Play';
    $('progressFill').style.width = '0%';
    $('t-current').textContent = '0:00';
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    ['m-peak','m-rms','m-gr','m-lufs'].forEach(id => { const el=$(id); if(el) el.style.width='0%'; });
    ['v-peak','v-rms'].forEach(id => set(id, '-∞ dB'));
    set('v-gr', '0.0 dB');
    set('v-lufs', '-∞ LUFS');
  });

  $('abBtn').addEventListener('click', () => {
    isDry = !isDry;
    $('abBtn').textContent = isDry ? 'B · DRY' : 'A · WET';
    if (audioCtx) updateMix();
  });
}

// ── EXPORT ─────────────────────────────────────────────────────
function initExport() {
  const expBtn = $('exportBtn');
  if (!expBtn) return;
  expBtn.addEventListener('click', async () => {
    if (!audioBuffer) return;
    expBtn.textContent = 'Rendering…'; expBtn.disabled = true;
    const off = new OfflineAudioContext(2, audioBuffer.length, audioBuffer.sampleRate);
    const src = off.createBufferSource(); src.buffer = audioBuffer;
    const oLow = off.createBiquadFilter(); oLow.type='lowshelf'; oLow.frequency.value=250; oLow.gain.value=nodes.low.gain.value;
    const oMid = off.createBiquadFilter(); oMid.type='peaking'; oMid.frequency.value=nodes.mid.frequency.value; oMid.gain.value=nodes.mid.gain.value; oMid.Q.value=nodes.mid.Q.value;
    const oHigh = off.createBiquadFilter(); oHigh.type='highshelf'; oHigh.frequency.value=6500; oHigh.gain.value=nodes.high.gain.value;
    const oShaper = off.createWaveShaper(); oShaper.curve = nodes.shaper.curve;
    const oShaperG = off.createGain(); oShaperG.gain.value = nodes.shaperGain.gain.value || 1;
    const oComp = off.createDynamicsCompressor();
    oComp.threshold.value=nodes.comp.threshold.value; oComp.ratio.value=nodes.comp.ratio.value; oComp.attack.value=0.01; oComp.release.value=0.1;
    const oLim = off.createDynamicsCompressor();
    oLim.threshold.value=nodes.limiter.threshold.value; oLim.ratio.value=20; oLim.attack.value=0.003; oLim.release.value=0.05;
    const k = 1/Math.sqrt(2);
    const oSplit=off.createChannelSplitter(2), oMerge=off.createChannelMerger(2);
    const oLM=off.createGain();oLM.gain.value=k; const oRM=off.createGain();oRM.gain.value=k;
    const oLS=off.createGain();oLS.gain.value=k; const oRS=off.createGain();oRS.gain.value=-k;
    const oMG=off.createGain();oMG.gain.value=1; const oSG=off.createGain();oSG.gain.value=nodes.sideGain.gain.value||1;
    const oML=off.createGain();oML.gain.value=1; const oMR=off.createGain();oMR.gain.value=1;
    const oSL=off.createGain();oSL.gain.value=1; const oSR=off.createGain();oSR.gain.value=-1;
    const oRev=off.createConvolver(); oRev.buffer=nodes.reverb.buffer;
    const oRevG=off.createGain(); oRevG.gain.value=nodes.reverbGain.gain.value;
    const oRevD=off.createGain(); oRevD.gain.value=nodes.reverbDry.gain.value;
    const oMas=off.createGain(); oMas.gain.value=nodes.master.gain.value;
    const oLA=off.createDelay(0.02); oLA.delayTime.value=0.005;
    src.connect(oShaper); oShaper.connect(oShaperG);
    oShaperG.connect(oLow); oLow.connect(oMid); oMid.connect(oHigh);
    oHigh.connect(oComp); oComp.connect(oLA); oLA.connect(oLim); oLim.connect(oSplit);
    oSplit.connect(oLM,0);oSplit.connect(oRM,1);oSplit.connect(oLS,0);oSplit.connect(oRS,1);
    oLM.connect(oMG);oRM.connect(oMG);oLS.connect(oSG);oRS.connect(oSG);
    oMG.connect(oML);oMG.connect(oMR);oSG.connect(oSL);oSG.connect(oSR);
    oML.connect(oMerge,0,0);oMR.connect(oMerge,0,1);oSL.connect(oMerge,0,0);oSR.connect(oMerge,0,1);
    oMerge.connect(oRevD); oMerge.connect(oRev); oRev.connect(oRevG);
    oRevG.connect(oMas); oRevD.connect(oMas); oMas.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const bitDepth = parseInt(($('bitDepthSelect') || $('ls-bitDepthSelect') || {value:'16'}).value);
    const useDither = ($('ditherCheck') || $('ls-ditherCheck') || {checked:true}).checked;
    if (useDither && bitDepth < 32) {
      const scale = Math.pow(2, bitDepth - 1);
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const data = rendered.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          const tpdf = Math.random() - Math.random();
          data[i] = Math.max(-1, Math.min(1, Math.round(data[i] * scale + tpdf * 0.5) / scale));
        }
      }
    }
    const suffix = (bitDepth===32?'_32f':'_'+bitDepth+'b') + (useDither&&bitDepth<32?'_dith':'');
    const wavBuf = bitDepth===32 ? bufferToWave32(rendered,rendered.length) : bufferToWave(rendered,rendered.length,bitDepth);
    const blob = new Blob([wavBuf],{type:'audio/wav'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'AUDIOLAB_v320_REMASTER' + suffix + '.wav';
    a.click();
    expBtn.textContent = 'Export Remaster (.WAV)'; expBtn.disabled = false;
  });
}

function bufferToWave(buffer, len, bitDepth=16) {
  const nCh=buffer.numberOfChannels, bps=bitDepth===24?3:2;
  const tot=44+len*nCh*bps, ab=new ArrayBuffer(tot), view=new DataView(ab);
  let p=0;
  const w16=d=>{view.setUint16(p,d,true);p+=2;};
  const w32=d=>{view.setUint32(p,d,true);p+=4;};
  w32(0x46464952);w32(tot-8);w32(0x45564157);
  w32(0x20746d66);w32(16);w16(1);w16(nCh);
  w32(buffer.sampleRate);w32(buffer.sampleRate*nCh*bps);w16(nCh*bps);w16(bitDepth);
  w32(0x61746164);w32(tot-p-4);
  const scale=Math.pow(2,bitDepth-1);
  for(let i=0;i<len;i++) for(let c=0;c<nCh;c++){
    const s=Math.max(-1,Math.min(1,buffer.getChannelData(c)[i]));
    const v=Math.round(s<0?s*scale:s*(scale-1));
    if(bitDepth===24){view.setUint8(p,v&0xFF);view.setUint8(p+1,(v>>8)&0xFF);view.setUint8(p+2,(v>>16)&0xFF);p+=3;}
    else{view.setInt16(p,v,true);p+=2;}
  }
  return ab;
}

function bufferToWave32(buffer, len) {
  const nCh=buffer.numberOfChannels, tot=44+len*nCh*4, ab=new ArrayBuffer(tot), view=new DataView(ab);
  let p=0;
  const w16=d=>{view.setUint16(p,d,true);p+=2;};
  const w32=d=>{view.setUint32(p,d,true);p+=4;};
  w32(0x46464952);w32(tot-8);w32(0x45564157);
  w32(0x20746d66);w32(16);w16(3);w16(nCh);
  w32(buffer.sampleRate);w32(buffer.sampleRate*nCh*4);w16(nCh*4);w16(32);
  w32(0x61746164);w32(tot-p-4);
  for(let i=0;i<len;i++) for(let c=0;c<nCh;c++){view.setFloat32(p,buffer.getChannelData(c)[i],true);p+=4;}
  return ab;
}

// ── DRAW LOOP (real-time visualisation) ────────────────────────
function drawLoop() {
  if (!isPlaying) return;
  animFrameId = requestAnimationFrame(drawLoop);
  updateProgress();

  const sc = specC(), scC = scopeC();
  if (!sc || !scC) return;

  // FFT Spectrum
  const W=sc.width, H=sc.height, sCtx=sc.getContext('2d');
  const freq=new Uint8Array(nodes.analyser.frequencyBinCount);
  nodes.analyser.getByteFrequencyData(freq);
  sCtx.clearRect(0,0,W,H);
  const bw=W/freq.length;
  for(let i=0;i<freq.length;i++){
    const n=freq[i]/255;
    const r=Math.round(80+175*n), g=Math.round(80*(1-n));
    sCtx.fillStyle=`rgb(${r},${g},0)`;
    sCtx.fillRect(i*bw, H-n*H, Math.max(1,bw-1), n*H);
  }

  // Vector Scope
  const scCtx=scC.getContext('2d'), SW=scC.width, SH=scC.height;
  scCtx.fillStyle='rgba(0,0,0,0.25)'; scCtx.fillRect(0,0,SW,SH);
  scCtx.strokeStyle='rgba(255,255,255,0.04)'; scCtx.lineWidth=1;
  scCtx.beginPath(); scCtx.moveTo(SW/2,0); scCtx.lineTo(SW/2,SH); scCtx.stroke();
  scCtx.beginPath(); scCtx.moveTo(0,SH/2); scCtx.lineTo(SW,SH/2); scCtx.stroke();
  const time=new Float32Array(nodes.analyser.fftSize);
  nodes.analyser.getFloatTimeDomainData(time);
  scCtx.strokeStyle='rgba(255,140,0,0.8)'; scCtx.lineWidth=1.5; scCtx.beginPath();
  const cx=SW/2, cy=SH/2, half=Math.floor(time.length/2);
  for(let i=0;i<half;i++){
    const L=time[i*2]||0, R=time[i*2+1]||L;
    const x=cx+((L+R)/Math.sqrt(2))*cx*0.9;
    const y=cy-((L-R)/Math.sqrt(2))*cy*0.9;
    i===0 ? scCtx.moveTo(x,y) : scCtx.lineTo(x,y);
  }
  scCtx.stroke();

  // True Peak ×8 + RMS
  const tdF=new Float32Array(nodes.analyser.fftSize);
  nodes.analyser.getFloatTimeDomainData(tdF);
  let truePeak=0, sumSq=0;
  for(let i=0;i<tdF.length-1;i++){
    sumSq+=tdF[i]*tdF[i];
    const b=tdF[i+1];
    for(let f=0;f<8;f++){const v=tdF[i]*(1-f/8)+b*(f/8); truePeak=Math.max(truePeak,Math.abs(v));}
  }
  const rms=Math.sqrt(sumSq/tdF.length);
  const peakDB=truePeak>0?20*Math.log10(truePeak):-96;
  const rmsDB=rms>0?20*Math.log10(rms):-96;
  const pkEl=$('v-peak');
  if(pkEl){pkEl.textContent=peakDB.toFixed(1)+' dBTP'; pkEl.style.color=peakDB>-1?'#ff3333':'var(--accent)';}
  set('v-rms', rmsDB.toFixed(1)+' dB');
  const mpk=$('m-peak'); if(mpk) mpk.style.width=Math.min(100,(peakDB+60)/60*100)+'%';
  const mrms=$('m-rms'); if(mrms) mrms.style.width=Math.min(100,(rmsDB+60)/60*100)+'%';

  // GR réel
  const realGR=nodes.comp.reduction||0;
  set('v-gr', realGR.toFixed(1)+' dB');
  const mgr=$('m-gr'); if(mgr) mgr.style.width=Math.min(100,Math.abs(realGR)*4)+'%';

  // LUFS momentary (BS.1770-4)
  (function(){
    const fL=new Float32Array(nodes.lufsAnalyserL.fftSize);
    const fR=new Float32Array(nodes.lufsAnalyserR.fftSize);
    nodes.lufsAnalyserL.getFloatTimeDomainData(fL);
    nodes.lufsAnalyserR.getFloatTimeDomainData(fR);
    let sL=0, sR=0;
    for(let i=0;i<fL.length;i++){sL+=fL[i]*fL[i]; sR+=fR[i]*fR[i];}
    lufsBuffer.push((sL+sR)/fL.length);
    const maxBlk=Math.max(1,Math.ceil(0.4*audioCtx.sampleRate/nodes.lufsAnalyserL.fftSize));
    if(lufsBuffer.length>maxBlk) lufsBuffer.shift();
    const meanPow=lufsBuffer.reduce((a,b)=>a+b,0)/lufsBuffer.length;
    const lufs=meanPow>1e-10?-0.691+10*Math.log10(meanPow):-96;
    set('v-lufs', lufs.toFixed(1)+' LUFS');
    const ml=$('m-lufs'); if(ml) ml.style.width=Math.min(100,Math.max(0,(lufs+60)/60*100))+'%';
  })();
}

// ── PRO ANALYSIS (EBU R128) ────────────────────────────────────
async function runFullAnalysis(buffer) {
  const ph=$('analysisPlaceholder'), re=$('analysisResults');
  const sp=$('analyzingMsg'), ld=$('analysis-led');
  if(ph) ph.style.display='none';
  if(re) re.style.display='none';
  if(sp) sp.style.display='block';
  if(ld) ld.style.background='#ff8c00';
  document.querySelectorAll('.preset-btn').forEach(b=>b.disabled=false);

  let intLUFS=-96, truePeakDB=-96, lra=0, crest=0, corr=0, spectral='Balanced', rmsDB=-96, score=0;
  try {
    const sr=buffer.sampleRate, nCh=buffer.numberOfChannels;
    const lData=buffer.getChannelData(0);
    const rData=nCh>1?buffer.getChannelData(1):lData;

    // True Peak ×8
    let truePeakLin=0;
    for(let c=0;c<nCh;c++){
      const d=buffer.getChannelData(c);
      for(let i=0;i<d.length-1;i++){
        const b2=d[i+1];
        for(let f=0;f<8;f++){const v=d[i]*(1-f/8)+b2*(f/8); truePeakLin=Math.max(truePeakLin,Math.abs(v));}
      }
    }
    truePeakDB = truePeakLin>0?20*Math.log10(truePeakLin):-96;

    // K-weighting IIR
    function kFilter(inp){
      const out=new Float32Array(inp.length);
      let s1=0; const a1=0.93, g1=1.58;
      for(let i=0;i<inp.length;i++){s1=a1*s1+(1-a1)*inp[i]; out[i]=inp[i]+(inp[i]-s1)*(g1-1);}
      let s2=0; const a2=0.9975;
      for(let i=0;i<inp.length;i++){s2=a2*s2+(1-a2)*out[i]; out[i]=out[i]-s2;}
      return out;
    }
    const kL=kFilter(lData), kR=kFilter(rData);

    // Integrated LUFS (EBU R128 double gate)
    const bsz=Math.floor(sr*0.1), hop=Math.floor(sr*0.075);
    const blockLoud=[];
    for(let s=0;s+bsz<=lData.length;s+=hop){
      let sum=0;
      for(let i=s;i<s+bsz;i++) sum+=kL[i]*kL[i]+kR[i]*kR[i];
      const p=sum/bsz;
      blockLoud.push(p>1e-10?-0.691+10*Math.log10(p):-96);
    }
    const aboveAbs=blockLoud.filter(l=>l>-70);
    if(!aboveAbs.length) throw new Error('Signal trop faible');
    const absM=aboveAbs.reduce((a,b)=>a+b,0)/aboveAbs.length;
    const relG=aboveAbs.filter(l=>l>absM-10);
    const intP=relG.reduce((a,b)=>a+Math.pow(10,(b+0.691)/10),0)/relG.length;
    intLUFS = intP>0?-0.691+10*Math.log10(intP):-96;

    // LRA (short-term 3s blocks)
    const stSz=Math.round(sr*3), stHop=Math.round(sr*1);
    const stBlocks=[];
    for(let i=0;i+stSz<=lData.length;i+=stHop){
      let sL=0, sR=0;
      for(let j=i;j<i+stSz;j++){sL+=kL[j]*kL[j]; sR+=kR[j]*kR[j];}
      const p=(sL+sR)/stSz;
      stBlocks.push(p>1e-10?-0.691+10*Math.log10(p):-96);
    }
    const stG=stBlocks.filter(l=>l>-70);
    const stS=[...(stG.length>1?stG:stBlocks)].sort((a,b)=>a-b);
    const lo10=stS[Math.max(0,Math.floor(stS.length*0.10))];
    const hi95=stS[Math.min(stS.length-1,Math.floor(stS.length*0.95))];
    lra = Math.max(0,hi95-lo10);

    // RMS + Crest
    let sumSq=0;
    for(let i=0;i<lData.length;i++) sumSq+=lData[i]*lData[i]+rData[i]*rData[i];
    const rmsLin=Math.sqrt(sumSq/(2*lData.length));
    rmsDB = rmsLin>0?20*Math.log10(rmsLin):-96;
    crest = truePeakDB - rmsDB;

    // Stereo correlation
    let num=0, denL=0, denR=0;
    const step=Math.max(1,Math.floor(lData.length/8000));
    for(let i=0;i<lData.length;i+=step){num+=lData[i]*rData[i]; denL+=lData[i]*lData[i]; denR+=rData[i]*rData[i];}
    const denom=Math.sqrt(denL*denR);
    corr = denom>0?num/denom:0;

    // Spectral balance
    function bandE(data,lo,hi,sr2){
      const dt=1/sr2, fc=(lo+hi)/2, bw=hi-lo;
      const alpha=Math.exp(-2*Math.PI*bw*dt), beta=1-Math.exp(-2*Math.PI*fc*dt);
      let e=0, cnt=0, prev=0, hp=0;
      for(let i=0;i<data.length;i+=step){hp=alpha*hp+beta*(data[i]-prev);prev=data[i];e+=hp*hp;cnt++;}
      return cnt>0?e/cnt:0;
    }
    const eLow=bandE(lData,20,250,sr), eMid=bandE(lData,250,4000,sr), eHigh=bandE(lData,4000,20000,sr);
    const eT=eLow+eMid+eHigh+1e-10;
    if(eLow/eT>0.5) spectral='Bass Heavy';
    else if(eHigh/eT>0.4) spectral='Bright';
    else if(eMid/eT>0.5) spectral='Mid Heavy';
    else if(eLow/eT>0.4&&eMid/eT<0.35) spectral='Warm';
    else spectral='Balanced';

    analysisData = {intLUFS,truePeakDB,lra,crest,corr,spectral,rmsDB};

    // Quality score
    if(intLUFS>-20&&intLUFS<-5) score+=40; else if(intLUFS>-30) score+=20;
    if(truePeakDB<-1) score+=20;
    if(lra>4&&lra<16) score+=20; else if(lra>2) score+=10;
    if(corr>0.3) score+=20; else if(corr>0) score+=10;
    score=Math.min(100,score);

  } catch(e) {
    console.error('Analysis error:', e);
    if(sp) sp.style.display='none';
    if(ph){ ph.style.display='block'; ph.textContent='⚠ Analyse échouée'; ph.style.color='#ff4444'; }
    if(ld) ld.style.background='#ff4444';
    const smBtn=$('smartMasterBtn'); if(smBtn) smBtn.disabled=false;
    document.querySelectorAll('.preset-btn').forEach(b=>b.disabled=false);
    return;
  }

  // Update all analysis IDs (portrait + landscape prefixes)
  const corrPct = Math.round(corr*100);
  const vals = {
    'int-lufs':    intLUFS.toFixed(1)+' LUFS',
    'int-tp':      truePeakDB.toFixed(1)+' dBTP',
    'int-lra':     lra.toFixed(1)+' dB',
    'int-crest':   crest.toFixed(1)+' dB',
    'int-corr':    corrPct+'%',
    'int-spec':    spectral,
    'ls-int-lufs': intLUFS.toFixed(1)+' LUFS',
    'ls-int-tp':   truePeakDB.toFixed(1)+' dBTP',
    'ls-int-lra':  lra.toFixed(1)+' dB',
    'ls-int-crest':crest.toFixed(1)+' dB',
    'ls-int-corr': corrPct+'%',
    'ls-int-spec': spectral,
  };
  Object.entries(vals).forEach(([id,v])=>set(id,v));

  // Color coding
  const lufsEl=$('int-lufs');
  if(lufsEl) lufsEl.style.color=(intLUFS>-6||intLUFS<-20)?'#ff4444':(intLUFS>-10||intLUFS<-16)?'#ffaa00':'#00ff88';
  const tpEl=$('int-tp');
  if(tpEl) tpEl.style.color=truePeakDB>-1?'#ff4444':truePeakDB>-3?'#ffaa00':'#00ff88';

  // Quality fill (portrait + landscape)
  ['qualityFill','ls-qualityFill'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.style.width=score+'%';
    el.style.background=score>79?'#00ff88':score>59?'#ffaa00':'#ff4444';
  });
  set('quality-score-txt', score+'/100');
  set('ls-quality-score-txt', score+'/100');

  if(sp) sp.style.display='none';
  if(re) re.style.display='block';
  if(ld){ ld.style.background='#00ff88'; ld.style.boxShadow='0 0 8px #00ff88'; }
  ['smartMasterBtn','ls-smartMasterBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=false;});
  document.querySelectorAll('.preset-btn').forEach(b=>b.disabled=false);
}

// ── PRESETS ────────────────────────────────────────────────────
const PRESETS = {
  streaming: {lufs:-14, limit:-1.0, ratio:4,  thresh:-24, warmth:15, width:100, reverb:15, decay:1.8, label:'Streaming -14 LUFS'},
  apple:     {lufs:-16, limit:-1.0, ratio:3,  thresh:-28, warmth:10, width:100, reverb:12, decay:1.6, label:'Apple Music -16 LUFS'},
  loud:      {lufs:-9,  limit:-0.5, ratio:8,  thresh:-18, warmth:35, width:105, reverb:8,  decay:1.2, label:'Loud -9 LUFS'},
  vinyl:     {lufs:-12, limit:-1.5, ratio:3,  thresh:-22, warmth:55, width:85,  reverb:20, decay:2.4, label:'Vinyl -12 LUFS'},
  edm:       {lufs:-7,  limit:-0.3, ratio:12, thresh:-16, warmth:55, width:130, reverb:10, decay:1.0, label:'EDM -7 LUFS'},
  chill:     {lufs:-16, limit:-1.0, ratio:2,  thresh:-30, warmth:25, width:110, reverb:30, decay:3.0, label:'Chill -16 LUFS'},
};

function applyPreset(type) {
  const p = PRESETS[type]; if (!p) return;
  const cur = analysisData ? analysisData.intLUFS : -18;
  const delta = Math.max(-30, Math.min(6, p.lufs - cur));
  const lim = analysisData && analysisData.truePeakDB > -0.5 ? Math.min(p.limit, -1.5) : p.limit;
  const vals = {'p-gain':delta,'p-limit':lim,'p-ratio':p.ratio,'p-thresh':p.thresh,'p-warmth':p.warmth,'p-width':p.width,'p-reverb':p.reverb,'p-decay':p.decay};
  Object.entries(vals).forEach(([id,val]) => {
    const el=$(id); if(!el) return;
    el.value=val;
    el.dispatchEvent(new Event('input'));
  });
  document.querySelectorAll('.preset-btn,.ls-preset-btn').forEach(b=>b.classList.remove('active'));
  ['pr-','ls-pr-'].forEach(pfx=>{ const b=$(pfx+type); if(b) b.classList.add('active'); });
  activePreset = type;
  showToast('✅ ' + p.label);
}

// ── ACCORDION (portrait only) ──────────────────────────────────
function toggleModule(header) {
  const content = header.parentNode.querySelector('.module-content');
  const chevron = header.querySelector('.chevron');
  if (!content) return;
  if (content.style.display === 'none' || content.style.display === '') {
    content.style.display = 'block';
    if(chevron) chevron.style.transform = 'rotate(0deg)';
  } else {
    content.style.display = 'none';
    if(chevron) chevron.style.transform = 'rotate(-90deg)';
  }
}

// ── BIT DEPTH / DITHER SYNC ────────────────────────────────────
function initExportSync() {
  ['bitDepthSelect','ls-bitDepthSelect'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('change',()=>{
      const other=$(id==='bitDepthSelect'?'ls-bitDepthSelect':'bitDepthSelect');
      if(other) other.value=el.value;
    });
  });
  ['ditherCheck','ls-ditherCheck'].forEach(id=>{
    const el=$(id); if(!el) return;
    el.addEventListener('change',()=>{
      const other=$(id==='ditherCheck'?'ls-ditherCheck':'ditherCheck');
      if(other) other.checked=el.checked;
    });
  });
}

// ── SMART MASTER ───────────────────────────────────────────────
function initSmartMaster() {
  ['smartMasterBtn','ls-smartMasterBtn'].forEach(id=>{
    const btn=$(id); if(!btn) return;
    btn.addEventListener('click',()=>{
      if(!audioBuffer){ showToast("⚠ Charge un fichier d'abord"); return; }
      let best='streaming';
      if(analysisData){
        if(analysisData.spectral==='Bass Heavy') best='edm';
        else if(analysisData.intLUFS<-20) best='loud';
      }
      applyPreset(best);
      showToast('⚡ Smart Master — '+PRESETS[best].label);
    });
  });
}

// ── PWA ────────────────────────────────────────────────────────
function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', {scope:'/'})
        .then(r => console.log('[AudioLab] SW:', r.scope))
        .catch(e => console.warn('[AudioLab] SW failed:', e));
    });
  }
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredPrompt = e;
    const b = $('pwa-install-banner'); if(b) b.style.display='flex';
    const installBtn = document.querySelector('#pwa-install-banner button');
    if(installBtn) installBtn.onclick = () => { deferredPrompt && deferredPrompt.prompt(); b.style.display='none'; };
  });
  window.addEventListener('appinstalled', () => {
    const b = $('pwa-install-banner'); if(b) b.style.display='none';
    showToast('✅ AudioLab Pro installé !');
  });
}

// ── BOOTSTRAP ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSliders();
  initProgressBar();
  initFileInput();
  initTransport();
  initExport();
  initExportSync();
  initSmartMaster();
  initPWA();

  // Portrait: open all modules by default
  document.querySelectorAll('.module-content').forEach(el => { el.style.display='block'; });

  // Orientation detection for portrait page
  window.addEventListener('resize', checkLandscape);
  window.addEventListener('orientationchange', checkLandscape);
  checkLandscape();
});

window.addEventListener('load', () => {
  resizeCanvases();
});
window.addEventListener('resize', resizeCanvases);
