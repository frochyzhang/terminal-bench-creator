import { useEffect, useRef, useCallback } from 'react';

/**
 * EventSource hook with auto-reconnect.
 * @param {string|null} url - SSE endpoint URL (null to disable)
 * @param {object} handlers - Event handler map: { eventName: handler }
 */
export function useSSE(url, handlers) {
  const esRef = useRef(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!url) return;

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      handlersRef.current?.message?.(e);
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3s
      setTimeout(() => {
        if (esRef.current === es) {
          connect();
        }
      }, 3000);
    };

    // Register named event handlers
    const eventNames = Object.keys(handlersRef.current || {}).filter(k => k !== 'message' && k !== 'error');
    for (const name of eventNames) {
      es.addEventListener(name, (e) => {
        try {
          const data = JSON.parse(e.data);
          handlersRef.current?.[name]?.(data);
        } catch {
          handlersRef.current?.[name]?.(e.data);
        }
      });
    }

    return es;
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const es = connect();
    return () => {
      esRef.current = null;
      es?.close();
    };
  }, [url, connect]);

  return {
    close: () => {
      esRef.current?.close();
      esRef.current = null;
    },
  };
}
