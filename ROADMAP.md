# BiblioVault AI — Roadmap

> Documento vivo. Se actualiza con cada fase completada.
> Ultima actualizacion: 2026-05-17

## Fases Completadas

| Fase | Descripcion | Estado |
|------|-------------|--------|
| 1-8 | Core (scanner, reader, TTS, AI chat, covers, metadata, search, OCR) | ✅ Done |
| 9 | Backup/Export (CSV, DB) | ✅ Done |
| 10 | Multi-user auth + JWT + user tables | ✅ Done |
| 11 | Cloud prep (PG adapter, Supabase, upload storage) | ✅ Done |
| 12 | Affiliates (links, clicks, tracking — infraestructura) | ✅ Done |
| 13 | Polish (UI redesign, mobile responsive) | ✅ Done |
| 13.5 | Stabilization sprint (10 bugs + multiuser rewiring) | ✅ Done |
| 14 | Payments + PayPal + Coupons + 9 bug fixes | ✅ Done |
| 15 | R2 Migration + Reader Audit (7 bugs) + Domain purchase | ✅ Done |
| 15.5 | Dashboard gamification + admin fixes + per-user stats | ✅ Done |
| — | Conectar dominio lecturaarcana.com (CNAME Render + Cloudflare) | ✅ Done |
| 16 | Landing page (Lectura Arcana): UI Mobile, Hero Filters, Copy | ✅ Done |
| 17 | Internacionalizacion BiblioVault-AI (ES + EN, 4 lotes) | ✅ Done |
| 18 | Filtros Avanzados (Idioma, Extension) y Soporte Nativo EPUB | ✅ Done |
| 19 | DOC/EPUB Reader Overhaul — 6 fases de estabilización | ✅ Done |

### Fase 19 — Detalle (completada 2026-05-17)

| Sub-fase | Cambio |
|----------|--------|
| DOC → PDF | `docConverter.ts` convierte DOC/DOCX a PDF via `pdf-lib` (puro JS, sin LibreOffice) |
| DOC Paginación | DOC se lee con `PdfReader` nativo — paginación real, doble página, zoom |
| DOC Portada | Scan de portada usa el PDF cacheado + MuPDF (igual que PDFs nativos) |
| DOC AI/TTS | `extractDocText()` + `extractEpubText()` en `textExtractor.ts` |
| EPUB Visual | Fondo de página, box-shadow, tema nocturno sólido, TOC styled |
| EPUB Doble Página | `pageLayout` prop + `rendition.spread('always')` |
| Cleanup | Eliminado `HtmlReader.tsx`, endpoint `/html`, Dockerfile |

---

## Próximos Pasos (Backlog Inmediato)

### 🔴 Prioridad Alta — Bugs Activos

| # | Bug | Estado | Componente |
|---|-----|--------|------------|
| B1 | Rutas locales visibles en BookDetail | 🟡 Pendiente | `BookDetail.tsx` → expone `C:\Users\...` |
| B2 | Portadas se pierden al re-deploy | 🟡 Pendiente | `r2_cover_key` null en algunos libros |
| B3 | Comunidad: crashea después de cargar | 🟡 Pendiente | `CommunityExplorer.tsx` error boundary |
| B4 | PDF no abre para admin (hbouche) | 🟡 Pendiente | `/api/books/:id/file` permisos |
| ~~B5~~ | ~~DOC renderiza solo 1 página~~ | ✅ Resuelto | Fase 19 — DOC→PDF via pdf-lib |
| B6 | Sidebar "Leyendo" post-fix | 🟡 Verificar | Dashboard per-user stats |

### 🔴 Prioridad Alta — Mobile Review

| # | Issue | Descripcion |
|---|-------|-------------|
| M1 | Flechas de retorno faltantes | Algunas pantallas no tienen botón "back" — el usuario queda atrapado o sale del app |
| M2 | Navegación móvil general | Auditoría completa del flujo mobile: sidebar, reader, bookdetail, comunidad |
| M3 | Responsive breakpoints | Verificar que todas las vistas funcionen en 375px-428px (iPhone SE → iPhone Pro Max) |
| M4 | Reader mobile UX | Gestos de swipe, botones de navegación, tamaño de texto en móvil |

### 📱 Prioridad Alta — Apps Nativas (Android / iOS)

| Opción | Descripción | Esfuerzo | Resultado |
|--------|------------|----------|-----------|
| **A) PWA (Progressive Web App)** | Agregar `manifest.json` + service worker. El usuario "instala" desde el browser. Ícono en home, pantalla completa, funciona offline (parcial). | 🟢 1-2 días | App instalable, sin tienda. Funciona en Android + iOS Safari. |
| **B) Capacitor (Ionic)** | Wrapper nativo que empaqueta la web app en APK/IPA. Acceso a APIs nativas (notificaciones, cámara, filesystem). Se sube a Play Store / App Store. | 🟡 3-5 días | App nativa real en tiendas. Mismo código web. |
| **C) React Native (rewrite)** | Reescribir la UI completa en React Native. Componentes nativos, performance óptima. | 🔴 2-4 semanas | Experiencia 100% nativa pero alto costo |

> **Recomendación**: **Opción A (PWA)** primero — es inmediato y cubre el 90% de los casos. Después **B (Capacitor)** para publicar en tiendas si se necesita.

### Prioridad Alta — Features

| Item | Descripcion | Notas |
|------|-------------|-------|
| Aislamiento Multi-usuario | Bookmarks, conversaciones IA y colecciones comparten datos entre usuarios. Filtrar con `WHERE user_id = $1`. | Bookmarks, AI, collections |
| Caché de Libros | No cargar 1,402 libros completos siempre. Cache local + invalidación por timestamp. | Performance |
| Amazon Affiliates | Conectar Amazon Associates para monetizar recomendaciones | Fase 12 tiene la infra |

### Prioridad Media — Features

| Item | Descripcion | Notas |
|------|-------------|-------|
| Rediseño de Hermes AI | Mejorar interfaz del chat (memoria de conversación, contexto del libro) | UI + prompts |
| Community view modes | Vista grid/card en CommunityBooks | Replicar viewMode de LibraryGrid |
| Coupon analytics | Dashboard admin para ver uso de cupones | Cuantos canjeados, conversion |
| Lanzar cupones | Campaña de lanzamiento con LANZAMIENTO30:30 | 200 followers iniciales |
| Limite de uso de cupones | Contador en DB para limitar a N usos | Prevenir abuso |

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

---

## 📖 White Label Reader — Producto Nuevo

> Lector universal de biblioteca personal. El usuario carga sus propios libros (PDF, EPUB, DOC).
> Multiplataforma: móvil, tablet, desktop. Sin contenido incluido — solo el motor de lectura.

### Concepto de Producto

| Aspecto | BiblioVault AI | White Label Reader |
|---------|---------------|-------------------|
| **Contenido** | Biblioteca curada de 1,400+ libros esotéricos | Vacío — el usuario trae sus libros |
| **Público** | Nicho esotérico | General — cualquier lector |
| **Backend** | Servidor centralizado (Render + R2) | Local-first (archivos en dispositivo) |
| **AI** | Hermes AI (Groq) | Opcional / premium |
| **Marca** | Lectura Arcana | Nombre independiente (configurable) |
| **Modelo** | Suscripción $12.99/mes | Freemium (gratis + premium) o pago único |

### Arquitectura: Qué se reutiliza

| Componente BiblioVault | Se reutiliza? | Adaptación |
|-----------------------|---------------|------------|
| `PdfReader` + pdf.js | ✅ Tal cual | Core del producto |
| `EpubReader` + epub.js | ✅ Tal cual | Core del producto |
| `docConverter` (DOC→PDF) | ✅ Tal cual | Core del producto |
| TTS (Web Speech API) | ✅ Tal cual | Feature gratuita |
| Tema nocturno / escala | ✅ Tal cual | Core UX |
| Doble página / layout | ✅ Tal cual | Core UX |
| Bookmarks + progreso | ✅ Con adaptación | IndexedDB local en vez de PostgreSQL |
| Scanner de biblioteca | ⚠️ Rediseñar | Input de archivos / drag-and-drop en vez de scan de carpetas |
| Hermes AI | ⚠️ Opcional | Feature premium — requiere API key |
| Covers / metadata | ⚠️ Simplificar | Extracción local on-device |
| Auth / PayPal | ❌ No se usa | Producto standalone |
| Admin panel | ❌ No se usa | No hay admin |
| Comunidad | ❌ No se usa | No hay social |

### Fases de Desarrollo

| Fase | Descripción | Esfuerzo |
|------|-------------|----------|
| WL-1 | Extraer componentes reader a paquete independiente | 2-3 días |
| WL-2 | UI shell: file picker, biblioteca local, grid de libros | 2-3 días |
| WL-3 | Persistencia local (IndexedDB: libros, bookmarks, progreso) | 1-2 días |
| WL-4 | PWA (installable, offline, responsive) | 1 día |
| WL-5 | Capacitor wrapper (APK + IPA para tiendas) | 2-3 días |
| WL-6 | Theming white-label (colores, logo, nombre configurables) | 1 día |
| WL-7 | Premium features (AI chat, TTS avanzado, sync cloud) | 3-5 días |
| **Total** | | **~2-3 semanas** |

### Stack Técnico

```
Frontend: React + Vite (mismo que BiblioVault)
Storage:  IndexedDB (OPFS para archivos grandes)
Package:  PWA + Capacitor (Android/iOS)
Backend:  Ninguno (local-first) — opcional para sync/AI
```

