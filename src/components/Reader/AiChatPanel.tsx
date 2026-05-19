import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Bot, Sparkles, X, StopCircle, BookOpen, Globe, ArrowRight, Search, Copy, Share2, Download, Check, Volume2, VolumeX, Settings, RotateCcw, BookmarkPlus, Microscope } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { streamAiChat, checkAiHealth, searchWebForAi, parseAiActions, logAiUsage, aiResearch, type ChatMessage, type AiAction } from '../../services/ai';
import { fetchBookText, fetchAiChatHistory, saveAiChatHistory, fetchBooks, addBookmark } from '../../services/api';
import type { Book } from '../../types';
import './AiChat.css';

interface AiChatPanelProps {
  book: Book;
  currentPage: number;
  onClose: () => void;
  onNavigate?: (action: AiAction) => void;
}

export default function AiChatPanel({ book, currentPage, onClose, onNavigate }: AiChatPanelProps) {
  const { t, i18n } = useTranslation();

  const QUICK_ACTIONS = [
    { label: t('aiChat.quickSummaryLabel'), prompt: t('aiChat.quickSummaryPrompt'), isWeb: false },
    { label: t('aiChat.quickExplainLabel'), prompt: t('aiChat.quickExplainPrompt'), isWeb: false },
    { label: t('aiChat.quickPhiloLabel'), prompt: t('aiChat.quickPhiloPrompt'), isWeb: false },
    { label: t('aiChat.quickReportLabel'), prompt: t('aiChat.quickReportPrompt'), isWeb: false },
    { label: t('aiChat.quickRelateLabel'), prompt: t('aiChat.quickRelatePrompt'), isWeb: false },
    { label: t('aiChat.quickSearchLabel'), prompt: '', isWeb: true },
  ];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hermesOnline, setHermesOnline] = useState<boolean | null>(null);
  const [pageContext, setPageContext] = useState<string>('');
  const [contextLoading, setContextLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [webSearchContext, setWebSearchContext] = useState<string>('');
  const [libraryContext, setLibraryContext] = useState<string>('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchMode, setSearchMode] = useState<'web' | 'library'>('web');
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingActions, setPendingActions] = useState<AiAction[]>([]);
  const [suggestedFollowUps, setSuggestedFollowUps] = useState<string[]>([]);
  const [sessionTokens, setSessionTokens] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const [savedNoteIndex, setSavedNoteIndex] = useState<number | null>(null);
  const [isResearching, setIsResearching] = useState(false);

  // B1: Resizable panel
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('hermes-panel-width');
    return saved ? parseInt(saved) : 380;
  });
  const isResizing = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const panelRight = window.innerWidth;
      const newWidth = Math.min(600, Math.max(280, panelRight - e.clientX));
      setPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('hermes-panel-width', String(panelWidth));
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [panelWidth]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // B2: New conversation
  const handleNewConversation = useCallback(() => {
    if (messages.length === 0) return;
    if (!confirm('¿Iniciar una nueva conversación? El historial actual se perderá.')) return;
    setMessages([]);
    setWebSearchContext('');
    setLibraryContext('');
    setSuggestedFollowUps([]);
    setPendingActions([]);
    setSessionTokens(0);
    saveAiChatHistory(book.id, []).catch(console.error);
  }, [messages, book.id]);

  // Load voices (they load async in Chrome)
  useEffect(() => {
    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const langPrefix = i18n.language === 'en' ? 'en' : 'es';
        const filtered = voices.filter(v => v.lang.startsWith(langPrefix));
        const sorted = filtered.sort((a, b) => {
          // Prioritize Google > Microsoft > others
          const score = (v: SpeechSynthesisVoice) => {
            const n = v.name.toLowerCase();
            if (n.includes('google')) return 3;
            if (n.includes('microsoft') && (n.includes('online') || n.includes('natural'))) return 2;
            if (n.includes('microsoft')) return 1;
            return 0;
          };
          return score(b) - score(a);
        });
        setAvailableVoices(sorted.length > 0 ? sorted : voices);
        // Auto-select best voice if none selected
        if (!selectedVoiceURI && sorted.length > 0) {
          setSelectedVoiceURI(sorted[0].voiceURI);
        }
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [i18n.language]);

  // TTS: speak or stop a message
  const handleSpeak = useCallback((text: string, index: number) => {
    if (speakingIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingIndex(null);
      return;
    }

    window.speechSynthesis.cancel();

    // Strip markdown formatting for cleaner speech
    const cleanText = text
      .replace(/[#*_~`>\-\[\]()!]/g, '')
      .replace(/\n+/g, '. ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = i18n.language === 'en' ? 'en-US' : 'es-MX';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    // Use selected voice or best available
    const voice = availableVoices.find(v => v.voiceURI === selectedVoiceURI) || availableVoices[0];
    if (voice) utterance.voice = voice;

    utterance.onend = () => setSpeakingIndex(null);
    utterance.onerror = () => setSpeakingIndex(null);

    setSpeakingIndex(index);
    window.speechSynthesis.speak(utterance);
  }, [speakingIndex, i18n.language, availableVoices, selectedVoiceURI]);

  // Stop TTS when panel closes
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  const handleExportPdf = async () => {
    if (messages.length === 0) return;
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      const addPageIfNeeded = (requiredSpace: number) => {
        if (y + requiredSpace > pageHeight - 25) {
          // Footer before new page
          doc.setFontSize(8);
          doc.setTextColor(120);
          doc.text('Generado por Hermes AI \u2022 Lectura Arcana \u2022 BiblioVault', pageWidth / 2, pageHeight - 10, { align: 'center' });
          doc.addPage();
          y = margin;
        }
      };

      // ── Header ──
      doc.setFillColor(30, 30, 50);
      doc.rect(0, 0, pageWidth, 45, 'F');
      doc.setFontSize(22);
      doc.setTextColor(255);
      doc.text('LECTURA ARCANA', pageWidth / 2, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setTextColor(180, 180, 220);
      doc.text('Informe de An\u00e1lisis con Hermes AI', pageWidth / 2, 27, { align: 'center' });
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }), pageWidth / 2, 35, { align: 'center' });
      y = 55;

      // ── Book metadata ──
      doc.setFillColor(245, 245, 255);
      doc.roundedRect(margin, y, contentWidth, 22, 3, 3, 'F');
      doc.setFontSize(11);
      doc.setTextColor(40);
      doc.text(`\ud83d\udcd6  ${book.title}`, margin + 5, y + 8);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`\u270d\ufe0f  ${book.author || 'Autor desconocido'}  \u2022  \ud83d\udcac ${messages.filter(m => m.role === 'user').length} preguntas  \u2022  ${sessionTokens.toLocaleString()} tokens`, margin + 5, y + 16);
      y += 30;

      // ── Separator ──
      doc.setDrawColor(200);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      // ── Conversation ──
      const stripMarkdown = (text: string) => text
        .replace(/@@ACTION:[^@]+@@/g, '')
        .replace(/@@FOLLOW_UPS:\[.*?\]@@/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/#{1,3}\s/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .trim();

      for (const msg of messages) {
        if (msg.role === 'system') continue;
        const isUser = msg.role === 'user';
        const label = isUser ? '\ud83d\udc64 Usuario' : '\ud83e\udd16 Hermes';
        const cleanText = stripMarkdown(msg.content);
        if (!cleanText) continue;

        addPageIfNeeded(20);

        // Role label
        doc.setFontSize(9);
        doc.setTextColor(isUser ? 80 : 102, isUser ? 80 : 126, isUser ? 80 : 234);
        doc.text(label, margin, y);
        y += 5;

        // Message content (word-wrapped)
        doc.setFontSize(10);
        doc.setTextColor(40);
        const lines = doc.splitTextToSize(cleanText, contentWidth - 5);
        for (const line of lines) {
          addPageIfNeeded(6);
          doc.text(line, margin + 3, y);
          y += 5;
        }
        y += 4;
      }

      // ── Final footer ──
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text('Generado por Hermes AI \u2022 Lectura Arcana \u2022 BiblioVault', pageWidth / 2, pageHeight - 10, { align: 'center' });

      doc.save(`Hermes_${book.title.replace(/[^\w\s]/g, '').replace(/\s+/g, '_').substring(0, 40)}.pdf`);
    } catch (err) {
      console.error('PDF Export error:', err);
    }
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  const handleShareMessage = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Hermes AI sobre ${book.title}`,
          text: text,
        });
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      handleCopyMessage(text, -1);
    }
  };

  // Check Hermes health (every 60s, not while streaming)
  useEffect(() => {
    checkAiHealth().then(setHermesOnline);
    const interval = setInterval(() => {
      if (!isStreaming) checkAiHealth().then(setHermesOnline);
    }, 60000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Load chat history on mount
  useEffect(() => {
    fetchAiChatHistory(book.id).then((history) => {
      if (history && history.length > 0) {
        setMessages(history);
      }
    }).catch(console.error);
  }, [book.id]);

  // Extract text from current page area when page changes
  useEffect(() => {
    if (book.format === 'image') return;

    const loadContext = async () => {
      setContextLoading(true);
      try {
        const startPage = Math.max(1, currentPage - 3);
        const endPage = currentPage + 3;
        const result = await fetchBookText(book.id, startPage, endPage);
        const text = result.fullText?.trim() || '';
        setPageContext(text.length > 50 ? text.substring(0, 6000) : '');
      } catch {
        setPageContext('');
      } finally {
        setContextLoading(false);
      }
    };

    const timer = setTimeout(loadContext, 2000);
    return () => clearTimeout(timer);
  }, [book.id, currentPage, book.format]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearchInput) {
      searchInputRef.current?.focus();
    }
  }, [showSearchInput]);

  // Helper for triggering LLM stream
  // Only send the last N messages to the LLM to keep token costs under control
  const MAX_CONTEXT_MESSAGES = 20;

  const processStream = useCallback(async (
    messagesToSend: ChatMessage[],
    overrideWebCtx?: string,
    overrideLibCtx?: string
  ) => {
    setIsStreaming(true);

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    const currentMessages = [...messagesToSend, assistantMessage];
    setMessages(currentMessages);

    abortRef.current = new AbortController();
    let fullResponse = '';

    await streamAiChat(
      messagesToSend.slice(-MAX_CONTEXT_MESSAGES).map((m) => ({ role: m.role, content: m.content })),
      book.title,
      book.author,
      pageContext || undefined,
      (token) => {
        fullResponse += token;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + token };
          }
          return updated;
        });
      },
      () => {
        setIsStreaming(false);
        const { cleanText, actions, followUps } = parseAiActions(fullResponse);

        let finalMessages = currentMessages;
        if (actions.length > 0 || followUps.length > 0) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: cleanText };
            }
            finalMessages = updated;
            return updated;
          });
          if (actions.length > 0) setPendingActions(actions);
          if (followUps.length > 0) setSuggestedFollowUps(followUps);
        } else {
           setMessages((prev) => {
             finalMessages = prev;
             return prev;
           });
        }
        
        setTimeout(() => {
          saveAiChatHistory(book.id, finalMessages).catch(console.error);
        }, 500);
      },
      (error) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: `⚠️ ${error}` };
          }
          return updated;
        });
        setIsStreaming(false);
      },
      abortRef.current.signal,
      overrideWebCtx !== undefined ? overrideWebCtx : (webSearchContext || undefined),
      overrideLibCtx !== undefined ? overrideLibCtx : (libraryContext || undefined),
      i18n.language,
      (usage) => {
        if (usage?.total_tokens) {
          setSessionTokens((prev) => prev + usage.total_tokens);
          // D1: Log to server
          logAiUsage(book.id, usage).catch(() => {});
        }
      }
    );
  }, [book.id, book.title, book.author, pageContext, webSearchContext, libraryContext, i18n.language]);

  // Handle web search
  const handleWebSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setShowSearchInput(false);

    const searchMsg: ChatMessage = {
      role: 'assistant',
      content: t('aiChat.searchingWeb', { query }),
      timestamp: new Date().toISOString(),
    };
    let currentMessages = [...messages, searchMsg];
    setMessages(currentMessages);

    try {
      const result = await searchWebForAi(query);

      if (result.count > 0) {
        setWebSearchContext(result.formatted);
        currentMessages = currentMessages.map(m => 
          m.timestamp === searchMsg.timestamp ? { ...m, content: t('aiChat.searchSuccess', { count: result.count, query }) } : m
        );
        
        const triggerMsg: ChatMessage = {
          role: 'user',
          content: `Acabo de buscar en la web sobre "${query}". Por favor, resume los resultados más importantes o dame una respuesta útil basada en esta información.`,
          timestamp: new Date().toISOString()
        };
        currentMessages = [...currentMessages, triggerMsg];
        setMessages(currentMessages);
        
        await processStream(currentMessages, result.formatted, libraryContext);
      } else {
        currentMessages = currentMessages.map(m => 
          m.timestamp === searchMsg.timestamp ? { ...m, content: t('aiChat.searchEmpty', { query }) } : m
        );
        setMessages(currentMessages);
      }
    } catch {
      currentMessages = currentMessages.map(m => 
        m.timestamp === searchMsg.timestamp ? { ...m, content: t('aiChat.searchError') } : m
      );
      setMessages(currentMessages);
    } finally {
      setIsSearching(false);
    }
  }, [messages, t, libraryContext, processStream]);

  // Handle library search
  const handleLibrarySearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setShowSearchInput(false);

    const searchMsg: ChatMessage = {
      role: 'assistant',
      content: `Buscando "${query}" en tu biblioteca...`,
      timestamp: new Date().toISOString(),
    };
    let currentMessages = [...messages, searchMsg];
    setMessages(currentMessages);

    try {
      // First try the full query
      let result = await fetchBooks({ search: query, limit: 20 });
      
      // If no results, try individual keywords (strip common words)
      if (!result.books || result.books.length === 0) {
        const stopWords = ['mas', 'más', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'en', 'con', 'por', 'para', 'que', 'del', 'al', 'libros', 'libro', 'buscar', 'busca', 'encuentra', 'dame', 'quiero', 'sobre', 'acerca', 'relacionados', 'hay', 'tiene', 'tienes'];
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
        
        for (const keyword of keywords) {
          result = await fetchBooks({ search: keyword, limit: 20 });
          if (result.books && result.books.length > 0) break;
        }
      }
      
      if (result.books && result.books.length > 0) {
        const formatted = result.books.map(b => `- [BOOK_ID:${b.id}] "${b.title}" por ${b.author || 'Desconocido'} (${b.category?.name || 'Varios'})`).join('\n');
        setLibraryContext(formatted);

        currentMessages = currentMessages.map(m => 
          m.timestamp === searchMsg.timestamp ? { ...m, content: `He encontrado ${result.books.length} libros en la biblioteca relacionados con "${query}".` } : m
        );
        
        const triggerMsg: ChatMessage = {
          role: 'user',
          content: `Por favor, analízame estos libros que encontraste en la biblioteca sobre "${query}" y dame una recomendación o resumen corto.`,
          timestamp: new Date().toISOString()
        };
        currentMessages = [...currentMessages, triggerMsg];
        setMessages(currentMessages);

        await processStream(currentMessages, webSearchContext, formatted);
      } else {
        currentMessages = currentMessages.map(m => 
          m.timestamp === searchMsg.timestamp ? { ...m, content: `No encontré ningún libro en tu biblioteca relacionado con "${query}".` } : m
        );
        setMessages(currentMessages);
      }
    } catch {
      currentMessages = currentMessages.map(m => 
        m.timestamp === searchMsg.timestamp ? { ...m, content: 'Ocurrió un error al buscar en la biblioteca.' } : m
      );
      setMessages(currentMessages);
    } finally {
      setIsSearching(false);
    }
  }, [messages, webSearchContext, processStream]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    
    await processStream(newMessages);
  }, [messages, isStreaming, processStream]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  // D3: Auto-summarize long conversations
  const handleSummarize = useCallback(async () => {
    if (messages.length < 6 || isStreaming) return;
    
    const summaryPrompt: ChatMessage = {
      role: 'user',
      content: `Por favor, genera un resumen ejecutivo de toda nuestra conversación hasta ahora. Incluye los puntos clave discutidos, las conclusiones principales y cualquier recomendación que hayas dado. Formato: Markdown con secciones.`,
      timestamp: new Date().toISOString(),
    };
    const newMessages = [...messages, summaryPrompt];
    setMessages(newMessages);
    await processStream(newMessages);
  }, [messages, isStreaming, processStream]);

  // D4: Research mode — parallel web + library search
  const handleResearchMode = useCallback(async (topic: string) => {
    if (!topic.trim() || isStreaming) return;
    setIsResearching(true);

    const searchMsg: ChatMessage = {
      role: 'assistant',
      content: `🔬 Investigando "${topic}" en la web y en tu biblioteca...`,
      timestamp: new Date().toISOString(),
    };
    let currentMessages = [...messages, searchMsg];
    setMessages(currentMessages);

    try {
      const result = await aiResearch(topic);
      
      if (result.web.formatted) setWebSearchContext(result.web.formatted);
      if (result.library.formatted) setLibraryContext(result.library.formatted);

      currentMessages = currentMessages.map(m =>
        m.timestamp === searchMsg.timestamp
          ? { ...m, content: `📊 Encontré ${result.web.count} fuentes web y ${result.library.count} libros en tu biblioteca sobre "${topic}".` }
          : m
      );

      const triggerMsg: ChatMessage = {
        role: 'user',
        content: `Acabo de investigar "${topic}". Analiza las fuentes web y los libros de mi biblioteca. Dame un informe comparativo: ¿qué dice la web? ¿qué libros de mi colección cubren este tema? ¿hay perspectivas únicas en mis libros que no aparecen en la web?`,
        timestamp: new Date().toISOString(),
      };
      currentMessages = [...currentMessages, triggerMsg];
      setMessages(currentMessages);

      await processStream(currentMessages, result.web.formatted, result.library.formatted);
    } catch {
      currentMessages = currentMessages.map(m =>
        m.timestamp === searchMsg.timestamp ? { ...m, content: 'Error al investigar. Intenta de nuevo.' } : m
      );
      setMessages(currentMessages);
    } finally {
      setIsResearching(false);
    }
  }, [messages, isStreaming, processStream]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendMessage(input);
    }
  };

  // B3: Auto-resize textarea
  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (searchMode === 'library') {
        handleLibrarySearch(searchQuery);
      } else {
        handleWebSearch(searchQuery);
      }
      setSearchQuery('');
    } else if (e.key === 'Escape') {
      setShowSearchInput(false);
      setSearchQuery('');
    }
  };

  const handleQuickAction = (action: typeof QUICK_ACTIONS[number]) => {
    if (action.isWeb) {
      setShowSearchInput(true);
      setSearchQuery(`${book.title} ${book.author}`.trim());
    } else {
      sendMessage(action.prompt);
    }
  };

  const handleExecuteAction = (action: AiAction) => {
    if (onNavigate) {
      onNavigate(action);
    }
    setPendingActions([]);
  };

  const getActionLabel = (action: AiAction) => {
    switch (action.type) {
      case 'search': return t('aiChat.actionSearch', { value: action.value });
      case 'category': return t('aiChat.actionCategory', { value: action.value });
      case 'open': return t('aiChat.actionOpenBook', { value: action.value });
      case 'navigate':
        if (action.value === 'library') return t('aiChat.actionLibrary');
        if (action.value === 'favorites') return t('aiChat.actionFavorites');
        if (action.value === 'reading') return t('aiChat.actionReading');
        return t('aiChat.actionNavigate', { value: action.value });
    }
  };

  return (
    <div className="reader-ai-panel" ref={panelRef} style={{ width: panelWidth }} onClick={(e) => e.stopPropagation()}>
      {/* B1: Resize handle */}
      <div className="ai-resize-handle" onMouseDown={startResize} />
      {/* Header */}
      <div className="reader-ai-header">
        <h3><Sparkles size={14} /> {t('aiChat.title')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="ai-status">
            <div className={`ai-status-dot ${hermesOnline ? 'online' : 'offline'}`} />
            <span className="ai-status-label">
              {hermesOnline === null ? '...' : hermesOnline ? 'Hermes' : 'Offline'}
            </span>
          </div>
          {pageContext && (
            <div className="ai-status" title="Contexto de página cargado">
              <BookOpen size={10} style={{ color: 'var(--accent-success)' }} />
              <span className="ai-status-label">p.{currentPage}</span>
            </div>
          )}
          {webSearchContext && (
            <div className="ai-status" title="Contexto de búsqueda web cargado">
              <Globe size={10} style={{ color: '#60a5fa' }} />
              <span className="ai-status-label">Web</span>
            </div>
          )}
          {libraryContext && (
            <div className="ai-status" title="Contexto de biblioteca cargado">
              <BookOpen size={10} style={{ color: 'var(--accent-primary)' }} />
              <span className="ai-status-label">Catálogo</span>
            </div>
          )}
          {sessionTokens > 0 && (
            <div className="ai-status" title="Tokens usados">
              <span className="ai-status-label" style={{ color: 'var(--accent-warning)' }}>
                {sessionTokens.toLocaleString()} t
              </span>
            </div>
          )}
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleNewConversation} title="Nueva conversación">
              <RotateCcw size={14} />
            </button>
          )}
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleExportPdf} title="Exportar a PDF">
              <Download size={14} />
            </button>
          )}
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={() => setShowVoicePicker(!showVoicePicker)}
            title="Configurar voz de Hermes"
            style={showVoicePicker ? { color: 'var(--accent-primary)' } : {}}
          >
            <Settings size={14} />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Voice Picker */}
      {showVoicePicker && (
        <div className="ai-voice-picker">
          <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>
            <Volume2 size={10} /> Voz de Hermes:
          </label>
          <select
            value={selectedVoiceURI}
            onChange={(e) => {
              setSelectedVoiceURI(e.target.value);
              setShowVoicePicker(false);
              // Preview the selected voice
              window.speechSynthesis.cancel();
              const voice = availableVoices.find(v => v.voiceURI === e.target.value);
              if (voice) {
                const preview = new SpeechSynthesisUtterance(i18n.language === 'en' ? 'Hello, I am Hermes.' : 'Hola, soy Hermes.');
                preview.voice = voice;
                preview.rate = 0.95;
                window.speechSynthesis.speak(preview);
              }
            }}
            className="ai-voice-select"
          >
            {availableVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} {v.name.toLowerCase().includes('google') ? '⭐' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div className="reader-ai-body">
        {messages.length === 0 ? (
          <div className="reader-ai-empty">
            <Bot size={48} />
            <p dangerouslySetInnerHTML={{ __html: t('aiChat.askAbout', { title: book.title }) }} />
            <p>
              {pageContext ? (
                <span style={{ fontSize: '0.85em', color: 'var(--accent-success)' }}>
                  {t('aiChat.readingPage', { page: currentPage })}
                </span>
              ) : contextLoading ? (
                <span style={{ fontSize: '0.85em' }}>{t('aiChat.loadingContext')}</span>
              ) : (
                <span style={{ fontSize: '0.85em' }}>{t('aiChat.canDo')}</span>
              )}
            </p>

            {/* Web/Library search input */}
            {showSearchInput && (
              <div className="ai-search-input-bar" style={{ borderColor: searchMode === 'library' ? 'var(--accent-primary)' : 'rgba(96, 165, 250, 0.4)' }}>
                {/* Mode toggle button */}
                <button
                  className="ai-search-mode-toggle"
                  onClick={() => setSearchMode(searchMode === 'web' ? 'library' : 'web')}
                  title={searchMode === 'web' ? 'Cambiar a Biblioteca' : 'Cambiar a Web'}
                  style={{
                    background: searchMode === 'library' ? 'rgba(102,126,234,0.15)' : 'rgba(96,165,250,0.15)',
                    color: searchMode === 'library' ? 'var(--accent-primary)' : '#60a5fa',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap' as const,
                    flexShrink: 0,
                  }}
                >
                  {searchMode === 'library' ? <><BookOpen size={12} /> Biblioteca</> : <><Globe size={12} /> Web</>}
                </button>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={searchMode === 'web' ? t('aiChat.searchPlaceholder') : 'Buscar en tu biblioteca...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <button
                  className="btn btn-primary btn-icon btn-sm"
                  onClick={() => { 
                    if (searchMode === 'web') handleWebSearch(searchQuery); 
                    else handleLibrarySearch(searchQuery);
                    setSearchQuery(''); 
                  }}
                  disabled={!searchQuery.trim() || isSearching}
                  title={searchMode === 'web' ? 'Buscar en la Web' : 'Buscar en la Biblioteca'}
                >
                  <Search size={12} />
                </button>
              </div>
            )}

            <div className="ai-quick-actions">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  className={`ai-quick-btn ${action.isWeb ? 'ai-quick-btn-web' : ''}`}
                  onClick={() => {
                    if (action.isWeb) {
                      setSearchMode('web');
                    }
                    handleQuickAction(action);
                  }}
                  disabled={!hermesOnline && !action.isWeb}
                >
                  {action.label}
                </button>
              ))}
              <button
                className="ai-quick-btn ai-quick-btn-web"
                style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
                onClick={() => {
                  setSearchMode('library');
                  setShowSearchInput(true);
                }}
              >
                Buscar en Biblioteca
              </button>
              <button
                className="ai-quick-btn"
                style={{ borderColor: '#10b981', color: '#10b981' }}
                onClick={() => {
                  const topic = prompt('¿Qué tema quieres investigar?');
                  if (topic) handleResearchMode(topic);
                }}
                disabled={isResearching}
              >
                <Microscope size={12} /> Investigar
              </button>
            </div>
          </div>
        ) : (
          <div className="ai-messages" ref={chatContainerRef}>
            {/* D3: Summarize banner for long conversations */}
            {messages.length >= 10 && !isStreaming && (
              <div style={{ textAlign: 'center', padding: '6px 0' }}>
                <button
                  className="ai-followup-btn"
                  style={{ fontSize: '11px', opacity: 0.8 }}
                  onClick={handleSummarize}
                >
                  📋 Resumir conversación ({messages.length} mensajes)
                </button>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <div className="ai-msg-assistant-content">
                    <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                    {msg.content && !isStreaming && (
                      <div className="ai-msg-actions">
                        <div className="ai-msg-action-group">
                          <button className={`ai-msg-action-btn ${speakingIndex === i ? 'active' : ''}`} onClick={() => handleSpeak(msg.content, i)}>
                            {speakingIndex === i ? <VolumeX size={15} /> : <Volume2 size={15} />}
                          </button>
                          <button className={`ai-msg-action-btn ${copiedIndex === i ? 'active success' : ''}`} onClick={() => handleCopyMessage(msg.content, i)}>
                            {copiedIndex === i ? <Check size={15} /> : <Copy size={15} />}
                          </button>
                          <button className="ai-msg-action-btn" onClick={() => handleShareMessage(msg.content)}>
                            <Share2 size={15} />
                          </button>
                          <button
                            className={`ai-msg-action-btn ${savedNoteIndex === i ? 'active success' : ''}`}
                            title="Guardar como nota"
                            onClick={async () => {
                              try {
                                const label = `🤖 Hermes: ${msg.content.substring(0, 60).replace(/[#*`]/g, '')}...`;
                                await addBookmark(book.id, currentPage, label, '#667eea');
                                setSavedNoteIndex(i);
                                setTimeout(() => setSavedNoteIndex(null), 2000);
                              } catch { /* ignore */ }
                            }}
                          >
                            {savedNoteIndex === i ? <Check size={15} /> : <BookmarkPlus size={15} />}
                          </button>
                        </div>
                      </div>
                    )}
                    {!isStreaming && i === messages.length - 1 && suggestedFollowUps.length > 0 && (
                      <div className="ai-followups">
                        {suggestedFollowUps.map((followUp, idx) => (
                          <button
                            key={idx}
                            className="ai-followup-btn"
                            onClick={() => sendMessage(followUp)}
                          >
                            {followUp} <ArrowRight size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            ))}

            {/* Pending navigation actions */}
            {pendingActions.length > 0 && !isStreaming && (
              <div className="ai-actions-bar">
                {pendingActions.map((action, i) => (
                  <button
                    key={i}
                    className="ai-action-btn"
                    onClick={() => handleExecuteAction(action)}
                  >
                    <ArrowRight size={12} />
                    {getActionLabel(action)}
                  </button>
                ))}
              </div>
            )}

            {isStreaming && (
              <div className="ai-typing">
                <div className="ai-typing-dot" />
                <div className="ai-typing-dot" />
                <div className="ai-typing-dot" />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Search bar (inline, shown when messages exist) */}
      {showSearchInput && messages.length > 0 && (
        <div className="ai-search-input-bar" style={{ margin: '0 12px 8px', borderRadius: '8px' }}>
          <Search size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('aiChat.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <button
            className="btn btn-primary btn-icon btn-sm"
            onClick={() => { handleWebSearch(searchQuery); setSearchQuery(''); }}
            disabled={!searchQuery.trim() || isSearching}
          >
            <Globe size={12} />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="reader-ai-input">
        {/* Web search toggle */}
        <button
          className={`btn btn-ghost btn-icon btn-sm ${webSearchContext ? 'ai-web-active' : ''}`}
          onClick={() => setShowSearchInput(!showSearchInput)}
          title={webSearchContext ? t('aiChat.tooltipWebLoaded') : t('aiChat.tooltipWebSearch')}
          style={{ flexShrink: 0 }}
        >
          <Globe size={14} />
        </button>

        <textarea
          ref={inputRef}
          rows={1}
          placeholder={hermesOnline ? t('aiChat.inputPlaceholder') : t('aiChat.inputUnavailable')}
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          disabled={!hermesOnline || isStreaming}
          style={{ resize: 'none', overflow: 'hidden' }}
        />
        {isStreaming ? (
          <button className="btn btn-primary btn-icon btn-sm" onClick={handleStop} title={t('aiChat.tooltipStop')}>
            <StopCircle size={14} />
          </button>
        ) : (
          <button
            className="btn btn-primary btn-icon btn-sm"
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || !hermesOnline}
          >
            <Send size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
