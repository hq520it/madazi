import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

type Severity = 'success' | 'error' | 'warning' | 'info';

interface Notice {
  id: number;
  message: string;
  severity: Severity;
}

interface SnackbarCtxValue {
  notify: (message: string, severity?: Severity) => void;
}

const SnackbarCtx = createContext<SnackbarCtxValue>({ notify: () => {} });

export function useSnackbar() {
  return useContext(SnackbarCtx);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const idRef = useRef(0);

  const notify = useCallback((message: string, severity: Severity = 'success') => {
    const id = ++idRef.current;
    setNotices((prev) => [...prev, { id, message, severity }]);
  }, []);

  const handleClose = useCallback((id: number) => {
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <SnackbarCtx.Provider value={value}>
      {children}
      {notices.map((n) => (
        <Snackbar
          key={n.id}
          open
          autoHideDuration={3000}
          onClose={() => handleClose(n.id)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert
            onClose={() => handleClose(n.id)}
            severity={n.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {n.message}
          </Alert>
        </Snackbar>
      ))}
    </SnackbarCtx.Provider>
  );
}
