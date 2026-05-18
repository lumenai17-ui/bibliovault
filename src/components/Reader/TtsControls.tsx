import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp,
  SkipForward,
  Repeat,
  X,
  Gauge,
  Mic,
} from 'lucide-react';
import './Tts.css';

const TTS_SETTINGS_KEY = 'bibliovault-tts-settings';

interface TtsSettings {
  voiceName: string;
  rate: number;
  pitch: number;
  autoContinue: boolean;
  pagesToRead: number; // 0 = unlimited
}

function loadSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(TTS_SETTINGS_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings;
}

function saveSettings(s: TtsSettings) {
  localStorage.setItem(TTS_SETTINGS_KEY, JSON.stringify(s));
}

const defaultSettings: TtsSettings = {
  voiceName: '',
  rate: 1,
  pitch: 1,
  autoContinue: true,
  pagesToRead: 0,
};

interface TtsControlsProps {
  text: string;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  fetchPageText: (page: number) => Promise<string>;
}

export default function TtsControls({
  text,
  currentPage,
  totalPages,
  onPageChange,
  fetchPageText,
}: TtsControlsProps) {
  const [settings, setSettings] = useState<TtsSettings>(loadSettings);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [readingPage, setReadingPage] = useState(0);
  const [startPage, setStartPage] = useState(0);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const isAutoAdvancing = useRef(false);
  const shouldStop = useRef(false);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Setup silent audio and media session for background playback on mobile
  useEffect(() => {
    // 1-second silent WAV base64
    const audio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
    audio.loop = true;
    silentAudioRef.current = audio;

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Narración IA',
        artist: 'BiblioVault TTS',
      });
    }

    return () => {
      audio.pause();
    };
  }, []);

  // Persist settings
  const updateSettings = useCallback((patch: Partial<TtsSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Load voices
  useEffect(() => {
    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      if (v.length > 0) {
        setVoices(v);
        // If no voice selected yet, find a Spanish one
        if (!settings.voiceName) {
          const esVoice = v.find((voice) => voice.lang.startsWith('es'));
          if (esVoice) updateSettings({ voiceName: esVoice.name });
          else updateSettings({ voiceName: v[0]?.name || '' });
        }
      }
    };
    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;
    return () => { speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Stop on unmount
  useEffect(() => {
    return () => {
      shouldStop.current = true;
      speechSynthesis.cancel();
    };
  }, []);

  const speakText = useCallback(
    (textToSpeak: string, page: number): Promise<'ended' | 'stopped'> => {
      return new Promise((resolve) => {
        if (!textToSpeak.trim() || shouldStop.current) {
          resolve('stopped');
          return;
        }

        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.rate = settings.rate;
        utterance.pitch = settings.pitch;

        const voice = voices.find((v) => v.name === settings.voiceName);
        if (voice) utterance.voice = voice;

        setReadingPage(page);
        setIsPlaying(true);
        setIsPaused(false);

        utterance.onend = () => resolve('ended');
        utterance.onerror = () => resolve('stopped');

        utteranceRef.current = utterance;
        speechSynthesis.speak(utterance);
      });
    },
    [settings.rate, settings.pitch, settings.voiceName, voices],
  );

  const handlePlay = useCallback(async () => {
    if (silentAudioRef.current && silentAudioRef.current.paused) {
      silentAudioRef.current.play().catch(() => {});
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }

    if (isPaused) {
      speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }

    shouldStop.current = false;
    isAutoAdvancing.current = false;
    const localStartPage = currentPage;
    setStartPage(currentPage);

    // Always fetch fresh text for current page (Bug 3 fix)
    let page = currentPage;
    let pageText: string;
    try {
      pageText = await fetchPageText(page);
      if (!pageText || pageText.trim().length < 20) {
        pageText = text; // fallback to prop
      }
    } catch {
      pageText = text;
    }

    while (true) {
      if (shouldStop.current) break;

      const result = await speakText(pageText, page);

      if (result === 'stopped' || shouldStop.current) break;

      // Check if we should auto-continue
      if (!settings.autoContinue) break;

      // Check page limit (Bug 4 fix: use local var, not stale state)
      if (settings.pagesToRead > 0) {
        const pagesRead = page - localStartPage + 1;
        if (pagesRead >= settings.pagesToRead) break;
      }

      // Move to next page
      if (page >= totalPages) break;

      page++;
      isAutoAdvancing.current = true;
      onPageChange(page);

      // Fetch next page text
      try {
        pageText = await fetchPageText(page);
        if (!pageText || pageText.trim().length < 20) {
          pageText = `Página ${page}. Sin texto legible.`;
        }
      } catch {
        break;
      }
    }

    setIsPlaying(false);
    setIsPaused(false);
    isAutoAdvancing.current = false;
  }, [
    text,
    currentPage,
    totalPages,
    isPaused,
    settings.autoContinue,
    settings.pagesToRead,
    speakText,
    onPageChange,
    fetchPageText,
  ]);

  const handlePause = useCallback(() => {
    speechSynthesis.pause();
    setIsPlaying(false);
    setIsPaused(true);
    
    if (silentAudioRef.current) silentAudioRef.current.pause();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  }, []);

  const handleStop = useCallback(() => {
    shouldStop.current = true;
    speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    isAutoAdvancing.current = false;
    
    if (silentAudioRef.current) silentAudioRef.current.pause();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
  }, []);

  const handleSkip = useCallback(() => {
    // Skip current page narration → will trigger auto-advance
    speechSynthesis.cancel();
  }, []);

  // Bind Media Session handlers once dependencies are ready
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', handlePlay);
      navigator.mediaSession.setActionHandler('pause', handlePause);
      navigator.mediaSession.setActionHandler('stop', handleStop);
      navigator.mediaSession.setActionHandler('nexttrack', handleSkip);
    }
    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('stop', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    };
  }, [handlePlay, handlePause, handleStop, handleSkip]);

  if (!('speechSynthesis' in window)) {
    return null;
  }

  // Group voices by language
  const voicesByLang: Record<string, SpeechSynthesisVoice[]> = {};
  voices.forEach((v) => {
    const lang = v.lang.split('-')[0];
    if (!voicesByLang[lang]) voicesByLang[lang] = [];
    voicesByLang[lang].push(v);
  });

  // Sort: Spanish first, then English, then rest
  const langOrder = ['es', 'en', ...Object.keys(voicesByLang).filter((l) => l !== 'es' && l !== 'en')];

  const activeVoice = voices.find((v) => v.name === settings.voiceName);

  return (
    <div className="tts-wrapper" style={{ position: 'relative' }}>
      {/* Floating TTS Bar */}
      <div className={`tts-bar ${isPlaying || isPaused ? 'tts-bar-active' : ''}`}>
        {/* Play/Pause button */}
        {isPlaying ? (
          <button className="tts-btn tts-btn-primary" onClick={handlePause} title="Pausar">
            <Pause size={16} />
          </button>
        ) : (
          <button
            className={`tts-btn ${isPaused ? 'tts-btn-primary' : 'tts-btn-play'}`}
            onClick={handlePlay}
            title={isPaused ? 'Continuar' : 'Narrar'}
          >
            <Play size={16} />
          </button>
        )}

        {/* Stop button */}
        {(isPlaying || isPaused) && (
          <>
            <button className="tts-btn" onClick={handleStop} title="Detener">
              <Square size={13} />
            </button>
            <button className="tts-btn" onClick={handleSkip} title="Saltar página">
              <SkipForward size={14} />
            </button>
          </>
        )}

        {/* Status / info */}
        {(isPlaying || isPaused) && (
          <div className="tts-status">
            <div className="tts-status-dot" />
            <span>
              {isPaused ? 'Pausado' : 'Leyendo'} p.{readingPage}
              {settings.pagesToRead > 0 && ` / ${settings.pagesToRead} págs`}
            </span>
          </div>
        )}

        {/* Voice name preview */}
        {!isPlaying && !isPaused && activeVoice && (
          <div className="tts-voice-preview" onClick={() => setShowPanel(!showPanel)}>
            <Mic size={11} />
            <span>{activeVoice.name.split(' ').slice(0, 2).join(' ')}</span>
          </div>
        )}

        {/* Settings toggle */}
        <button
          className={`tts-btn tts-btn-settings ${showPanel ? 'active' : ''}`}
          onClick={() => setShowPanel(!showPanel)}
          title="Configurar narración"
        >
          <Volume2 size={14} />
          {showPanel ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      </div>

      {/* Settings Panel */}
      {showPanel && (
        <div className="tts-panel">
          <div className="tts-panel-header">
            <h4>🎙️ Narración</h4>
            <button className="tts-btn" onClick={() => setShowPanel(false)}>
              <X size={12} />
            </button>
          </div>

          {/* Voice Selection */}
          <div className="tts-section">
            <label className="tts-label">
              <Mic size={12} /> Voz
            </label>
            <select
              className="tts-select"
              value={settings.voiceName}
              onChange={(e) => updateSettings({ voiceName: e.target.value })}
            >
              {langOrder.map((lang) =>
                voicesByLang[lang]?.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                )),
              )}
            </select>
          </div>

          {/* Speed */}
          <div className="tts-section">
            <label className="tts-label">
              <Gauge size={12} /> Velocidad: {settings.rate.toFixed(1)}x
            </label>
            <div className="tts-slider-row">
              <span className="tts-slider-label">0.5x</span>
              <input
                className="tts-slider"
                type="range"
                min="0.5"
                max="2.5"
                step="0.1"
                value={settings.rate}
                onChange={(e) => updateSettings({ rate: parseFloat(e.target.value) })}
              />
              <span className="tts-slider-label">2.5x</span>
            </div>
          </div>

          {/* Pitch */}
          <div className="tts-section">
            <label className="tts-label">Tono: {settings.pitch.toFixed(1)}</label>
            <div className="tts-slider-row">
              <span className="tts-slider-label">Grave</span>
              <input
                className="tts-slider"
                type="range"
                min="0.5"
                max="1.5"
                step="0.1"
                value={settings.pitch}
                onChange={(e) => updateSettings({ pitch: parseFloat(e.target.value) })}
              />
              <span className="tts-slider-label">Agudo</span>
            </div>
          </div>

          <div className="tts-divider" />

          {/* Auto-continue */}
          <div className="tts-section">
            <label className="tts-toggle-row">
              <Repeat size={12} />
              <span>Auto-continuar a siguiente página</span>
              <button
                className={`tts-toggle ${settings.autoContinue ? 'active' : ''}`}
                onClick={() => updateSettings({ autoContinue: !settings.autoContinue })}
              >
                <div className="tts-toggle-thumb" />
              </button>
            </label>
          </div>

          {/* Pages to read */}
          {settings.autoContinue && (
            <div className="tts-section">
              <label className="tts-label">Páginas a leer</label>
              <div className="tts-pages-options">
                {[0, 3, 5, 10, 20, 50].map((n) => (
                  <button
                    key={n}
                    className={`tts-page-btn ${settings.pagesToRead === n ? 'active' : ''}`}
                    onClick={() => updateSettings({ pagesToRead: n })}
                  >
                    {n === 0 ? '∞' : n}
                  </button>
                ))}
              </div>
              <span className="tts-hint">
                {settings.pagesToRead === 0 ? 'Leer sin límite' : `Leer ${settings.pagesToRead} páginas desde la actual`}
              </span>
            </div>
          )}

          {/* Quick test */}
          <div className="tts-section">
            <button className="tts-test-btn" onClick={() => {
              speechSynthesis.cancel();
              const u = new SpeechSynthesisUtterance('Probando la voz seleccionada para BiblioVault.');
              u.rate = settings.rate;
              u.pitch = settings.pitch;
              const v = voices.find((v) => v.name === settings.voiceName);
              if (v) u.voice = v;
              speechSynthesis.speak(u);
            }}>
              <Play size={12} /> Probar voz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
