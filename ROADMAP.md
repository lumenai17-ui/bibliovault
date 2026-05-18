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
| 19 | DOC/EPUB Reader Overhaul (pdf-lib, portadas, AI/TTS) | ✅ Done |
| 20 | UX Sprint: Auth scroll, back navigation (9 secciones), path exposure | ✅ Done |
| 20.5 | Auditoría 360° (OOM, Multi-tenant, PayPal, React.lazy, Sentry) | ✅ Done |

---

## Próximos Pasos — Orden de Ejecución

### Fase 21 — Persistencia de Estado (Browser Refresh)
> Que al refrescar el browser NO te lleve al inicio

| Item | Descripción |
|------|-------------|
| URL Routing | Implementar React Router o hash-based routing (`/#/stats`, `/#/settings`, etc.) |
| State Restore | Guardar `activeSection` en `sessionStorage` → restaurar al reload |
| Reader Restore | Si estás leyendo un libro, volver al mismo libro y página |
| Deep Links | URLs compartibles: `app.lecturaarcana.com/#/book/123` |

---

### Fase 22 — Auditoría Mobile + Aislamiento Multi-usuario
> Auditoría completa de mobile + seguridad de datos entre usuarios

| Item | Descripción | Estado |
|------|-------------|--------|
| M2: Nav mobile | Flujo completo: sidebar, reader, bookdetail, comunidad | ✅ Done |
| M3: Responsive | Verificar 375px-428px (iPhone SE → Pro Max) | ✅ Done |
| M4: Reader UX | Gestos swipe, botones, tamaño texto en móvil | ✅ Done |
| Aislamiento | Bookmarks, conversaciones AI, colecciones → `WHERE user_id = $1` | ✅ Done |
| Datos cruzados | Auditar cada query que toca datos de usuario | ✅ Done |

---

### Fase 23 — Performance + Portadas
> Cache de catálogo + persistencia de portadas

| Item | Descripción |
|------|-------------|
| Cache catálogo | No cargar 1,400+ libros completos cada vez. Cache local + delta |
| Portadas R2 | Auditar libros con `cover_path` local pero sin `r2_cover_key` |
| Script fix | Batch script para subir portadas faltantes a R2 |
| Lazy load | Paginación o scroll infinito en el grid |

---

### Fase 24 — App Móvil (iOS + Android)
> PWA primero, Capacitor después para tiendas

| Item | Descripción |
|------|-------------|
| PWA | `manifest.json` + service worker + offline shell |
| Ícono + Splash | Assets para iOS/Android home screen |
| Capacitor | Wrapper nativo → APK (Play Store) + IPA (App Store) |
| Push Notifications | Opcional — nuevos libros, comunidad |
| Cuentas dev | Google Play ($25 una vez) + Apple Dev ($99/año) |

---

### Fase 25 — Amazon Affiliates
> Conectar Amazon Associates para comisionar recomendaciones

| Item | Descripción |
|------|-------------|
| Registro | Crear cuenta Amazon Associates |
| Links reales | Conectar infra de Fase 12 con links de Amazon reales |
| UI de compra | Botón "Comprar en Amazon" en BookDetail con tag de afiliado |
| Tracking | Dashboard de clicks, conversiones, comisiones |
| Compliance | Disclaimers requeridos por Amazon en la UI |

---

## Backlog (sin priorizar)

| Item | Descripción |
|------|-------------|
| Rediseño Hermes AI | Memoria de conversación, contexto mejorado |
| Community views | Grid/card en CommunityBooks |
| Coupon analytics | Dashboard de uso de cupones |
| Límite cupones | Contador en DB |
| Upgrade Render | Starter → Standard si hay problemas de RAM |

---

## Portal Lectura Arcana (Proyecto Separado)

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Core de biblioteca | ✅ 100% |
| 2 | Definición comercial | ✅ 100% |
| 3 | Portal Web / Landing Page | 🔧 85% |
| 4 | Ecosistema UGC (foros, afiliados, subidas) | 📋 Pendiente |
| 5 | YouTube Funnel | 📋 Pendiente |
| 6 | Lanzamiento | 📋 Pendiente |

---

## 📖 White Label Reader (Futuro)

> Lector universal de biblioteca personal — producto independiente.
> El usuario carga sus propios libros (PDF, EPUB, DOC).
> Local-first, multiplataforma. Se construye cuando las fases 21-25 estén listas.
