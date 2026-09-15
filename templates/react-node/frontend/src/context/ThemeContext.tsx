import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, type Theme } from '@mui/material/styles';

type Mode = 'light' | 'dark';

interface ThemeCtxValue {
  mode: Mode;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeCtxValue>({ mode: 'light', toggle: () => {} });

export function useThemeMode() {
  return useContext(ThemeCtx);
}

function getInitialMode(): Mode {
  const saved = localStorage.getItem('admin_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getDesignTokens(mode: Mode): Theme {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: '#3370ff' },
      ...(isDark
        ? {
            background: { default: '#121417', paper: '#1e2127' },
            divider: 'rgba(255,255,255,0.09)',
          }
        : {
            background: { default: '#f2f4f8', paper: '#ffffff' },
            divider: 'rgba(0,0,0,0.08)',
          }),
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    },
    components: {
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiTableCell: { styleOverrides: { root: { whiteSpace: 'nowrap' } } },
    },
  });
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>(getInitialMode);

  useEffect(() => {
    localStorage.setItem('admin_theme', mode);
  }, [mode]);

  const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);
  const theme = useMemo(() => getDesignTokens(mode), [mode]);

  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);
  return (
    <ThemeCtx.Provider value={value}>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </ThemeCtx.Provider>
  );
}
