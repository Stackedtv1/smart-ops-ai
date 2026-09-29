import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Tiny router. Each NavProvider keeps its own path, so Presenter Mode can show
// the operator phone and the command dashboard side by side in one page.
const NavCtx = createContext(null);

const readHash = () => {
  const h = (typeof window !== 'undefined' && window.location.hash) || '';
  const p = h.replace(/^#/, '');
  return p.startsWith('/') ? p : '/';
};

export function NavProvider({ initial = '/', syncHash = false, scrollTarget = null, children }) {
  const [stack, setStack] = useState(() => [syncHash ? readHash() : initial]);
  const path = stack[stack.length - 1];

  useEffect(() => {
    if (!syncHash) return;
    const onHash = () => {
      const p = readHash();
      setStack((s) => (s[s.length - 1] === p ? s : [...s, p]));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [syncHash]);

  const go = useCallback(
    (to, { replace = false } = {}) => {
      setStack((s) => (replace ? [...s.slice(0, -1), to] : [...s, to]));
      if (syncHash) {
        try {
          if (replace) window.history.replaceState(null, '', `#${to}`);
          else window.history.pushState(null, '', `#${to}`);
        } catch {
          /* hash updates are a convenience only */
        }
      }
      const scroller = scrollTarget && document.querySelector(scrollTarget);
      if (scroller) scroller.scrollTop = 0;
      else window.scrollTo(0, 0);
    },
    [syncHash, scrollTarget]
  );

  const back = useCallback(
    (fallback = '/') => {
      setStack((s) => {
        const next = s.length > 1 ? s.slice(0, -1) : [fallback];
        if (syncHash) {
          try {
            window.history.replaceState(null, '', `#${next[next.length - 1]}`);
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    },
    [syncHash]
  );

  const value = useMemo(() => ({ path, go, back }), [path, go, back]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}

export function useNav() {
  return useContext(NavCtx);
}

// match('/ticket/:id', '/ticket/SMART-1') -> { id: 'SMART-1' }
export function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('?')[0].split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, className, children, ...rest }) {
  const { go } = useNav();
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
