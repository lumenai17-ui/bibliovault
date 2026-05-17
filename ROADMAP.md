# BiblioVault AI — Roadmap

> Documento vivo. Se actualiza con cada fase completada.
> Ultima actualizacion: 2026-05-17

## Fases Completadas

| Fase | Descripcion | Estado |
|------|-------------|--------|
| 1-8 | Core (scanner, reader, TTS, AI chat, covers, metadata, search, OCR) | Done |
| 9 | Backup/Export (CSV, DB) | Done |
| 10 | Multi-user auth + JWT + user tables | Done |
| 11 | Cloud prep (PG adapter, Supabase, upload storage) | Done |
| 12 | Affiliates (links, clicks, tracking — infraestructura) | Done |
| 13 | Polish (UI redesign, mobile responsive) | Done |
| 13.5 | Stabilization sprint (10 bugs + multiuser rewiring) | Done |
| 14 | Payments + PayPal + Coupons + 9 bug fixes | Done |
| 15 | R2 Migration + Reader Audit (7 bugs) + Domain purchase | Done |
| 15.5 | Dashboard gamification + admin fixes + per-user stats | Done |
| — | Conectar dominio lecturaarcana.com (CNAME Render + Cloudflare) | Done |
| 16 | Landing page (Lectura Arcana): UI Mobile, Hero Filters, Copy | Done |
| 17 | Internacionalizacion BiblioVault-AI (ES + EN, 4 lotes) | Done |
| 18 | Filtros Avanzados (Idioma, Extension) y Soporte Nativo EPUB | Done |

---

## Próximos Pasos (Backlog Inmediato)

### Prioridad Alta — Bugs Activos 🔴

| # | Bug | Descripcion | Componente | Notas |
|---|-----|-------------|------------|-------|
| B1 | Rutas locales visibles | "UBICACIÓN" en BookDetail muestra `C:\Users\...\2.000 Libros\FILOSOFÍA\...` — la ruta local del PC del dueño, no el nombre de archivo o R2 key. Dato sensible y confuso para usuarios externos. | `BookDetail.tsx` L569 → `book.filePath` | **Fix**: Reemplazar con `book.fileName` o con el `r2_file_key`. Nunca exponer rutas absolutas del sistema al frontend. |
| B2 | Portadas se pierden al re-deploy | Ciertos PDFs pierden la carátula cada vez que Render reinicia (ej: "El Nuevo Pensamiento", "La Filosofia Perenne", "Metafisica" en FILOSOFÍA). La mayoría persiste, estos no. | `index.ts` cover endpoint + `uploadCoverToCloudAndGetUrl` | **Causa probable**: El batch cover fix subió a R2 pero no guardó `r2_cover_key` en la DB para esos libros específicos. Al reiniciar, el endpoint busca primero `r2_cover_key` → null → cae al SVG fallback. Necesita un script de auditoría que verifique todos los libros con `cover_path` local pero sin `r2_cover_key`. |
| B3 | Comunidad: pantalla azul | La sección Comunidad carga brevemente y luego crashea a pantalla azul. | `CommunityExplorer.tsx` → `loadAll()` | **Causa probable**: Error en una de las 5 llamadas paralelas (`fetchCommunities`, `fetchMyCommunities`, `fetchBookCommunities`, `fetchOfficialCommunities`, `fetchRecentThreads`) — un endpoint que no existe o devuelve un formato inesperado. Los `.catch(() => [])` deberían atrapar errores, pero si el componente se desmonta durante la carga puede causar un state update en componente desmontado. Necesita debug con la consola del navegador. |
| B4 | PDF no abre para admin | En cuenta hbouche los PDFs no cargan, en cuentas externas si | `index.ts` `/api/books/:id/file` | Media |
| B5 | DOC renderiza solo 1 pagina | Archivos .doc solo muestran la primera pagina | `UnifiedReader` + `HtmlReader` | Baja |
| B6 | Sidebar "Leyendo" post-fix | Verificar que el fix de per-user stats funcione tras deploy | Dashboard | Media |

### Prioridad Alta — Features

| Item | Descripcion | Notas |
|------|-------------|-------|
| Aislamiento Multi-usuario | Las tablas de bookmarks, conversaciones IA y colecciones actualmente comparten datos entre usuarios. Se requiere aislar con `WHERE user_id = $1`. | Bookmarks, AI conversations, collections — tienen user_id pero no se filtran |
| Caché de Libros (Performance) | Optimizar la carga del catálogo inicial (no cargar 1,402 libros completos siempre, usar caché local con invalidación por timestamp). | Primer load completo, siguientes desde cache + delta |
| Amazon Affiliates | Conectar Amazon Associates para monetizar recomendaciones de libros | Fase 12 construyo la infra (links, clicks, tracking) pero NO se registro en Amazon ni se conectaron links reales |

### Prioridad Media — Features

| Item | Descripcion | Notas |
|------|-------------|-------|
| Rediseño de Hermes AI | Mejorar la interfaz del chat del lector (memoria de conversación y contexto del libro). | UI del panel de chat, prompts mejorados |
| Community view modes | Vista grid/card en CommunityBooks (solo muestra tabla) | Replicar viewMode de LibraryGrid |
| Coupon analytics | Dashboard admin para ver uso de cupones | Cuantos canjeados, por quien, conversion |
| Lanzar cupones | Campana de lanzamiento con LANZAMIENTO30:30 | Para los 200 followers iniciales |
| Limite de uso de cupones | Agregar contador en DB para limitar a N usos | Prevenir abuso |

### Prioridad Baja — Infraestructura

| Item | Descripcion | Notas |
|------|-------------|-------|
| Upgrade Render | $7 Starter → $25 Standard | Solo si hay problemas de memoria |
| Amazon Associates signup | Registrarse en el programa de afiliados | Requiere sitio con trafico |
| Cover persistence | Portadas en Supabase Storage (dual con R2) | Redundancia |

---

## Portal Lectura Arcana (Proyecto Separado)

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Core de biblioteca (React/Express/SQLite/TTS/AI) | ✅ 100% |
| 2 | Definición comercial (mercado, pricing, naming) | ✅ 100% |
| 3 | Portal Web / Landing Page | 🔧 85% |
| 4 | Ecosistema UGC (foros, afiliados, subidas) | 📋 Pendiente |
| 5 | YouTube Funnel (audiolibros, canal) | 📋 Pendiente |
| 6 | Lanzamiento (auth, pagos, beta, SEO) | 📋 Pendiente |
