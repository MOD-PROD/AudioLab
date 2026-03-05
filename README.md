# AUDI⊙LAB PR⊙ — Professional Mastering Suite

> 🎛️ Un moteur de mastering audio professionnel **100% dans le navigateur**, propulsé par la Web Audio API.  
> Installable comme une app native (PWA). Aucune dépendance, aucun build, zéro serveur.

![Version](https://img.shields.io/badge/version-3.2.0-orange)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-production-brightgreen)
![PWA](https://img.shields.io/badge/PWA-installable-blueviolet)
![Web Audio](https://img.shields.io/badge/Web_Audio_API-supported-blue)

---

## 🚀 Demo en ligne

👉 **[https://mod-prod.github.io/AudioLabPro](https://mod-prod.github.io/AudioLabPro/)**

---

## 📱 Installation PWA

AudioLab Pro est une **Progressive Web App** : installez-la sur votre appareil en un clic.

| Plateforme | Méthode |
|------------|---------|
| **Android / Chrome** | Bandeau "Installer" → bouton **Installer** |
| **iOS / Safari** | Partager → **Sur l'écran d'accueil** |
| **Desktop Chrome / Edge** | Icône ⊕ dans la barre d'adresse |

✅ Fonctionne **hors-ligne** après la première visite (Service Worker + cache).

---

## ✨ Fonctionnalités

### 🎚️ Modules de traitement

| Module | Description |
|--------|-------------|
| **Tonality** | EQ 3 bandes (Lowshelf 250 Hz, Peaking variable, Highshelf 6.5 kHz) |
| **Warmth** | Saturation harmonique analogique (algorithme `tanh`) |
| **Compressor** | Compresseur dynamique (threshold, ratio, attack/release automatiques) |
| **Limiter** | Limiteur brickwall (ratio 20:1) — défaut **−1 dBFS** |
| **Mid/Side** | Contrôle de la largeur stéréo par matrice Mid/Side |
| **Reverb** | Réverbération convolutive avec pré-delay, early reflections et damping |
| **Master Gain** | Volume de sortie final calibré en dBFS |

### 📊 Analyse en temps réel

| Mesure | Détail |
|--------|--------|
| **FFT Spectrum** | Visualisation spectrale temps réel (Canvas 2D) |
| **Vector Scope** | Corrélation stéréo Lissajous |
| **True Peak** | Oversampling ×4 (inter-sample peaks) affiché en **dBTP** |
| **RMS** | Niveau efficace en dB |
| **Gain Reduction** | Valeur réelle `comp.reduction` (Web Audio API) |
| **Momentary LUFS** | Intégration glissante 400 ms — filtres K-weighting BS.1770-4 |

### 🔬 Pro Analysis (analyse offline EBU R128)

Analyse complète au chargement du fichier via `OfflineAudioContext` :

| Métrique | Méthode |
|----------|---------|
| **Integrated LUFS** | Double gating EBU R128 (gate absolue −70 LUFS + gate relative −10 LU) |
| **True Peak** | Oversampling ×4 sur tous les canaux |
| **LRA** | Loudness Range (p10 / p95 sur blocs gatés) |
| **Crest Factor** | True Peak − RMS |
| **Stereo Correlation** | Corrélation vectorielle normalisée (−1 à +1) |
| **Spectral Balance** | Énergie Low / Mid / High via filtres IIR par bande |
| **Quality Score** | Score 0–100 composite (LUFS, TP, LRA, corrélation) |

### ⚡ Smart Master & Presets

| Preset | Cible LUFS | Usage |
|--------|-----------|-------|
| **Streaming** | −14 LUFS | Spotify, YouTube, Deezer |
| **Apple Music** | −16 LUFS | Apple Music, iTunes |
| **Loud** | −9 LUFS | CD, maxi commercial |
| **Vinyl** | −12 LUFS | Pressage vinyle, warmth +55 |
| **EDM** | −7 LUFS | Club, DJ set, bass heavy |
| **Chill** | −16 LUFS | Lo-fi, ambient, podcasts |

Le bouton **⚡ Smart Master** analyse le morceau chargé et applique automatiquement le preset le plus adapté (détection genre spectral + niveau).

### 🎧 Transport

- Lecture / Pause / Stop avec seek interactif
- Mode **A/B** (Dry vs Wet) pour comparaison instantanée

### 💾 Export

- Export **WAV 16-bit PCM** avec toute la chaîne de traitement
- Rendu offline via `OfflineAudioContext` (qualité identique à la lecture)

---

## 📂 Formats supportés

`MP3` · `WAV` · `FLAC` · `OGG` · `AAC` · `MP4` · `M4A` · `MOV`

> Les fichiers MP4/MOV avec piste audio AAC sont supportés nativement. Les fichiers vidéo sans piste audio affichent une erreur explicite.

---

## 🛠️ Technologies

| Technologie | Usage |
|-------------|-------|
| **Web Audio API** | Traitement audio natif (nodes, analyser, compressor…) |
| **OfflineAudioContext** | Analyse pro + export WAV |
| **Canvas 2D** | FFT Spectrum + Vector Scope |
| **Service Worker** | Cache offline, mise à jour automatique |
| **Web App Manifest** | Installation PWA native |
| **CSS Grid / Media Queries** | Layout responsive portrait + landscape |
| **JetBrains Mono** | Typographie monospace |

---

## 📦 Structure du projet

```
AudioLabPro/
├── index.html        # Application complète (single file)
├── manifest.json     # PWA manifest
├── sw.js             # Service Worker (cache offline)
├── vercel.json       # Config Vercel (headers, routing)
├── .gitignore
├── LICENSE
├── README.md
└── assets/
    ├── icon-16x16.png
    ├── icon-32x32.png
    ├── icon-48x48.png
    ├── icon-64x64.png
    ├── icon-128x128.png
    ├── icon-256x256.png
    └── icon-512x512.png
```

---

## 🚀 Déploiement

### GitHub Pages (gratuit, recommandé)

```bash
git clone https://github.com/MOD-PROD/AudioLabPro.git
cd AudioLabPro
# Activer GitHub Pages : Settings → Pages → Branch: main → / (root)
```

URL : `https://mod-prod.github.io/AudioLabPro/`

### Vercel (gratuit, CDN mondial)

```bash
# Option 1 : Import depuis GitHub
# → vercel.com → New Project → Import MOD-PROD/AudioLabPro

# Option 2 : CLI
npm i -g vercel
vercel --prod
```

URL : `https://audiolab-pro.vercel.app`

### Local (sans serveur)

```bash
git clone https://github.com/MOD-PROD/AudioLabPro.git
cd AudioLabPro
# Ouvrir index.html dans Chrome/Firefox
# (le SW ne fonctionne pas en file://, utiliser un serveur local)
npx serve .
```

> ⚠️ Le Service Worker et l'installation PWA nécessitent **HTTPS** ou `localhost`.

---

## 🎯 Workflow recommandé

1. **Charger** un fichier audio (MP3, WAV, FLAC, OGG, MP4…)
2. Attendre l'**analyse Pro** automatique (LUFS, True Peak, LRA…)
3. Cliquer **⚡ Smart Master** pour les réglages optimaux, ou choisir un **preset** manuel
4. **Ajuster finement** avec les modules (Tonality, Dynamics, Space, Final)
5. Écouter avec le mode **A/B** (original vs masterisé)
6. **Exporter** le remaster en WAV 16-bit

### 📡 Cibles LUFS recommandées

| Plateforme | Cible | Limiter |
|------------|-------|---------|
| Spotify | −14 LUFS | −1 dBTP |
| Apple Music | −16 LUFS | −1 dBTP |
| YouTube | −14 LUFS | −1 dBTP |
| Tidal / Qobuz | −14 LUFS | −1 dBTP |
| CD / Master | −9 LUFS | −0.5 dBTP |
| Vinyle | −12 LUFS | −1.5 dBTP |

---

## 📄 Licence

MIT © 2026 — Libre d'utilisation, modification et distribution.

---

<p align="center">
  Made with 🎛️ and Web Audio API
</p>
