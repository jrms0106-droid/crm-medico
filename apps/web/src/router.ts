import { useEffect, useState } from 'react';

/** Rota atual a partir do `#` da URL, por exemplo `#/pacientes/123?x=1`. */
export interface Route {
  path: string[];
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  return {
    path: pathPart.split('/').filter(Boolean).map(decodeURIComponent),
    params: new URLSearchParams(queryPart),
  };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}

export const href = (to: string) => `#${to}`;
