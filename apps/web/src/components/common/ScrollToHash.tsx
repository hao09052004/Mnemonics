import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Ensures anchor hash links (e.g. /#how, /#product, /#privacy) scroll smoothly
 * to the matching element, both on route transitions and on initial page loads.
 */
export function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const targetId = hash.replace(/^#/, '');
      const scroll = () => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      scroll();
      const t1 = setTimeout(scroll, 80);
      const t2 = setTimeout(scroll, 240);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [pathname, hash]);

  return null;
}
