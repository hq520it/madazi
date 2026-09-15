import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { DictProvider } from './context/DictContext';
import { SnackbarProvider } from './context/SnackbarContext';
import AdminLayout from './layouts/AdminLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/system/Users';
import Roles from './pages/system/Roles';
import Menus from './pages/system/Menus';
import Dicts from './pages/system/Dicts';
import Items from './pages/demo/Items';
import { Forbidden, NotFound, RequireAuth, PermRoute } from './pages/ErrorPages';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppThemeProvider>
      <SnackbarProvider>
        <AuthProvider>
          <DictProvider>
            <HashRouter>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <AdminLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<PermRoute code="dashboard"><Dashboard /></PermRoute>} />
                  <Route path="system/users" element={<PermRoute code="system:user"><Users /></PermRoute>} />
                  <Route path="system/roles" element={<PermRoute code="system:role"><Roles /></PermRoute>} />
                  <Route path="system/menus" element={<PermRoute code="system:menu"><Menus /></PermRoute>} />
                  <Route path="system/dicts" element={<PermRoute code="system:dict"><Dicts /></PermRoute>} />
                  <Route path="demo/items" element={<PermRoute code="demo:item"><Items /></PermRoute>} />
                  <Route path="403" element={<Forbidden />} />
                  <Route path="404" element={<NotFound />} />
                  <Route path="*" element={<Navigate to="/404" replace />} />
                </Route>
              </Routes>
            </HashRouter>
          </DictProvider>
        </AuthProvider>
      </SnackbarProvider>
    </AppThemeProvider>
  </React.StrictMode>
);
