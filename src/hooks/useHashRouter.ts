import { useState, useEffect, useCallback } from 'react';

/**
 * Hash-based router for BiblioVault.
 * Maps activeSection ↔ URL hash to persist navigation across browser refreshes.
 *
 * Examples:
 *   'home'          → #/
 *   'stats'         → #/stats
 *   'cat-5'         → #/cat/5
 *   'col-3'         → #/col/3
 *   'admin-users'   → #/admin/users
 *   'admin-pending' → #/admin/pending
 *   'admin-coupons' → #/admin/coupons
 */

const SECTION_TO_HASH: Record<string, string> = {
  home: '/',
  all: '/library',
  favorites: '/favorites',
  reading: '/reading',
  recent: '/recent',
  stats: '/stats',
  settings: '/settings',
  community: '/community',
  'my-books': '/my-books',
  'community-books': '/community-books',
  admin: '/admin',
  'admin-users': '/admin/users',
  'admin-pending': '/admin/pending',
  'admin-coupons': '/admin/coupons',
};

function sectionToHash(section: string): string {
  if (SECTION_TO_HASH[section]) return SECTION_TO_HASH[section];
  if (section.startsWith('cat-')) return `/cat/${section.replace('cat-', '')}`;
  if (section.startsWith('col-')) return `/col/${section.replace('col-', '')}`;
  return '/';
}

function hashToSection(hash: string): string {
  // Remove leading #/ or #
  const path = hash.replace(/^#\/?/, '') || '/';

  // Dynamic routes
  const catMatch = path.match(/^cat\/(\d+)$/);
  if (catMatch) return `cat-${catMatch[1]}`;

  const colMatch = path.match(/^col\/(\d+)$/);
  if (colMatch) return `col-${colMatch[1]}`;

  // Static routes (reverse lookup)
  for (const [section, hashPath] of Object.entries(SECTION_TO_HASH)) {
    if (hashPath === `/${path}` || (path === '/' && hashPath === '/')) {
      return section;
    }
  }

  return 'home';
}

export function useHashRouter(): [string, (section: string) => void] {
  const [section, setSection] = useState(() =>
    hashToSection(window.location.hash)
  );

  // Listen for browser back/forward
  useEffect(() => {
    const handler = () => {
      setSection(hashToSection(window.location.hash));
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  // Navigate: update hash + state
  const navigate = useCallback((newSection: string) => {
    const newHash = sectionToHash(newSection);
    // Only update hash if it actually changed (avoid duplicate pushState)
    if (window.location.hash !== `#${newHash}`) {
      window.location.hash = newHash;
    }
    setSection(newSection);
  }, []);

  return [section, navigate];
}
