import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, Sparkles, X, StopCircle, BookOpen, Globe, ArrowRight, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { streamAiChat, checkAiHealth, searchWebForAi, parseAiActions, type ChatMessage, type AiAction } from '../../services/ai';
import { fetchBookText } from '../../services/api';
import type { Book } from '../../types';
import './AiChat.css';

interface AiChatPanelProps {
  book: Book;
  currentPage: number;
  onClose: () => void;
  onNavigate?: (action: AiAction) => void;
}

const QUICK_ACTIONS = [
  { label: '📝 Resumen', prompt: 'Dame un resumen detallado de este libro basándote en el texto que tienes disponible.' },
  { label: '🤔 Explica', prompt: 'Explícame los conceptos principales de lo que estoy leyendo de forma clara y sencilla.' },
  { label: '💭 Filosofar', prompt: 'Hablemos sobre las ideas filosóficas que presenta este texto. ¿Cuáles son las implicaciones más profundas?' },
  { label: '📊 Reporte', prompt: 'Genera un reporte académico de lo leído: tema central, argumentos principales, fortalezas, debilidades y conclusión.' },
  { label: '🔗 Relacionar', prompt: '¿Con qué otros libros o corrientes de pensamiento se relaciona este contenido? Explica las conexiones.' },
  { label: '🌐 Buscar Web', prompt: '' }, // Special action — triggers web search dialog
];

export default function AiChatPanel({ book, currentPage, onClose, onNavigate }: AiChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hermesOnline, setHermesOnline] = useState<boolean | null>(null);
  const [pageContext, setPageContext] = useState<string>('');
  const [contextLoading, setContextLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [webSearchContext, setWebSearchContext] = useState<string>('');
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingActions, setPendingActions] = useState<AiAction[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Check Hermes health
  useEffect(() => {
    checkAiHealth().then(setHermesOnline);
    const interval = setInterval(() => {
      if (!isStreaming) checkAiHealth().then(setHermesOnline);
    }, 15000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  // Extract text from current page area when page changes
  useEffect(() => {
    if (book.format === 'image') return;

    const loadContext = async () => {
      setContextLoading(true);
      try {
        const startPage = Math.max(1, currentPage - 1);
        const endPage = currentPage + 1;
        const result = await fetchBookText(book.id, startPage, endPage);
        const text = result.fullText?.trim() || '';
        setPageContext(text.length > 50 ? text.substring(0, 4000) : '');
      } catch {
        setPageContext('');
      } finally {
        setContextLoading(false);
      }
    };

    const timer = setTimeout(loadContext, 1000);
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

  // Handle web search
  const handleWebSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setShowSearchInput(false);

    // Add a system-like message showing the search
    const searchMsg: ChatMessage = {
      role: 'assistant',
      content: `🔍 Buscando en la web: **"${query}"**...`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, searchMsg]);

    try {
      const result = await searchWebForAi(query);

      if (result.count > 0) {
        setWebSearchContext(result.formatted);

        // Update the search message with results
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.content.includes('Buscando en la web')) {
            updated[updated.length - 1] = {
              ...last,
              content: `🌐 **${result.count} resultados encontrados** para "${query}".\n\nEl contexto de búsqueda se ha cargado. Ahora puedo responder preguntas usando esta información. ¡Pregúntame lo que quieras!`,
            };
          }
          return updated;
        });
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.content.includes('Buscando en la web')) {
            updated[updated.length - 1] = {
              ...last,
              content: `⚠️ No se encontraron resultados para "${query}". Intenta con otros términos.`,
            };
          }
          return updated;
        });
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.content.includes('Buscando en la web')) {
          updated[updated.length - 1] = {
            ...last,
            content: `⚠️ Error al buscar en la web. Verifica tu conexión a internet.`,
          };
        }
        return updated;
      });
    } finally {
      setIsSearching(false);
    }
  }, []);

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
    setIsStreaming(true);

    // Add empty assistant message that will be streamed into
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages([...newMessages, assistantMessage]);

    abortRef.current = new AbortController();

    let fullResponse = '';

    await streamAiChat(
      newMessages.map((m) => ({ role: m.role, content: m.content })),
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

        // Parse actions from the complete response
        const { cleanText, actions } = parseAiActions(fullResponse);

        // Clean up the displayed message (remove action tags)
        if (actions.length > 0) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: cleanText };
            }
            return updated;
          });
          setPendingActions(actions);
        }
      },
      (error) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: `⚠️ ${error}`,
            };
          }
          return updated;
        });
        setIsStreaming(false);
      },
      abortRef.current.signal,
      webSearchContext || undefined,
    );
  }, [messages, isStreaming, book.title, book.author, pageContext, webSearchContext]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      sendMessage(input);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleWebSearch(searchQuery);
      setSearchQuery('');
    } else if (e.key === 'Escape') {
      setShowSearchInput(false);
      setSearchQuery('');
    }
  };

  const handleQuickAction = (action: typeof QUICK_ACTIONS[number]) => {
    if (action.label === '🌐 Buscar Web') {
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
      case 'search': return `🔍 Buscar: "${action.value}"`;
      case 'category': return `📁 Ir a: ${action.value}`;
      case 'open': return `📖 Abrir libro #${action.value}`;
      case 'navigate':
        if (action.value === 'library') return '🏠 Ir a Biblioteca';
        if (action.value === 'favorites') return '❤️ Ir a Favoritos';
        if (action.value === 'reading') return '📚 Ir a Leyendo';
        return `🔗 Navegar: ${action.value}`;
    }
  };

  return (
    <div className="reader-ai-panel" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="reader-ai-header">
        <h3><Sparkles size={14} /> Asistente AI</h3>
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
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="reader-ai-body">
        {messages.length === 0 ? (
          <div className="reader-ai-empty">
            <Bot size={48} />
            <p>
              Pregúntame sobre <strong>"{book.title}"</strong>.
              {pageContext ? (
                <><br /><span style={{ fontSize: '0.85em', color: 'var(--accent-success)' }}>
                  ✅ Leyendo el contenido de la página {currentPage}
                </span></>
              ) : contextLoading ? (
                <><br /><span style={{ fontSize: '0.85em' }}>Cargando contexto...</span></>
              ) : (
                <><br /><span style={{ fontSize: '0.85em' }}>Puedo resumir, explicar, filosofar, buscar en web o navegar tu biblioteca.</span></>
              )}
            </p>

            {/* Web search input */}
            {showSearchInput && (
              <div className="ai-search-input-bar">
                <Search size={14} />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="¿Qué buscar en la web?"
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

            <div className="ai-quick-actions">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  className={`ai-quick-btn ${action.label === '🌐 Buscar Web' ? 'ai-quick-btn-web' : ''}`}
                  onClick={() => handleQuickAction(action)}
                  disabled={!hermesOnline && action.label !== '🌐 Buscar Web'}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
                {msg.role === 'assistant' ? (
                  <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
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
            placeholder="¿Qué buscar en la web?"
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
          title={webSearchContext ? 'Contexto web cargado — click para buscar más' : 'Buscar en la web'}
          style={{ flexShrink: 0 }}
        >
          <Globe size={14} />
        </button>

        <input
          ref={inputRef}
          type="text"
          placeholder={hermesOnline ? 'Pregunta sobre este libro...' : 'Hermes AI no disponible...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!hermesOnline || isStreaming}
        />
        {isStreaming ? (
          <button className="btn btn-primary btn-icon btn-sm" onClick={handleStop} title="Detener">
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
