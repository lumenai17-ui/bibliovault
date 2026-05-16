# BiblioVault AI — Roadmap

> Documento vivo. Se actualiza con cada fase completada.
> Ultima actualizacion: 2026-05-16

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

---

## Fase Actual

| Fase | Descripcion | Estado |
|------|-------------|--------|
| 17 | Internacionalizacion Portal (ES + EN) | Done |

---

## Backlog — Prioridad Alta (Ingresos y Lanzamiento)

| Item | Descripcion | Notas |
|------|-------------|-------|
| Amazon Affiliates | Conectar Amazon Associates para monetizar recomendaciones de libros | Fase 12 construyo la infra (links, clicks, tracking) pero NO se registro en Amazon ni se conectaron links reales |
| Lanzar cupones | Campana de lanzamiento con LANZAMIENTO30:30 | Para los 200 followers iniciales |
| Limite de uso de cupones | Agregar contador en DB para limitar a N usos | Prevenir abuso |

## Backlog — Prioridad Alta (Performance y UX)

| Item | Descripcion | Notas |
|------|-------------|-------|
| Cache de libros | No cargar 1,402 libros cada vez que se abre la app | Cache local con timestamp de invalidacion. Primer load completo, siguientes desde cache + delta |
| AI Section Makeover | Redisenar la experiencia de Hermes AI (chat del lector) | UI del panel de chat, contexto de lectura, memoria de conversacion, prompts mejorados |
| Revision de memorias AI | Conversaciones AI en estado zombie (user_id existe pero no se filtra) | Un usuario puede ver chats de otro sobre el mismo libro |

## Backlog — Prioridad Media (Multi-user Isolation)

| Item | Descripcion | Notas |
|------|-------------|-------|
| Per-user bookmarks | Tabla tiene user_id pero no se filtra | Query falta WHERE user_id = $1 |
| Per-user AI conversations | Misma tabla compartida entre usuarios | Filtrar por user_id en GET |
| Per-user collections | Colecciones compartidas entre usuarios | Aislar por usuario |

## Backlog — Prioridad Media (Features)

| Item | Descripcion | Notas |
|------|-------------|-------|
| Community view modes | Vista grid/card en CommunityBooks (solo muestra tabla) | Replicar viewMode de LibraryGrid |
| Coupon analytics | Dashboard admin para ver uso de cupones | Cuantos canjeados, por quien, conversion |

## Backlog — Prioridad Baja (Infraestructura)

| Item | Descripcion | Notas |
|------|-------------|-------|
| Upgrade Render | $7 Starter → $25 Standard | Solo si hay problemas de memoria |
| Amazon Associates signup | Registrarse en el programa de afiliados | Requiere sitio con trafico |
| Cover persistence | Portadas en Supabase Storage (dual con R2) | Redundancia |

## Bugs Conocidos

| Bug | Descripcion | Severidad |
|-----|-------------|-----------|
| PDF no abre para admin | En cuenta hbouche los PDFs no cargan, en cuentas externas si | Media |
| DOC renderiza solo 1 pagina | Archivos .doc solo muestran la primera pagina | Baja |
| Sidebar "Leyendo" post-fix | Verificar que el fix de per-user stats funcione tras deploy | Media |
