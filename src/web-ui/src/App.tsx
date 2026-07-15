/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  LayoutDashboard,
  Wrench,
  Radio,
  Menu,
  X,
  Terminal,
  Globe,
  Settings,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import {HashRouter as Router, Routes, Route, NavLink} from 'react-router-dom';

import wsClient from './lib/ws';
import HooksPage from './routes/hooks';
import OverviewPage from './routes/overview';
import SettingsPage from './routes/settings';
import SiteExperiencesPage from './routes/site-experiences';
import ToolsPage from './routes/tools';

function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Nav link style generator
  const getNavLinkClass = ({isActive}: {isActive: boolean}) => {
    return `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
      isActive
        ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-accent)] border border-[var(--color-border-default)] shadow-inner'
        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]'
    }`;
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      {/* Mobile Header */}
      <header className="md:hidden absolute top-0 left-0 right-0 h-16 bg-[var(--color-bg-secondary)]/90 backdrop-blur-md border-b border-[var(--color-border-default)] flex items-center justify-between px-4 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center">
            <Terminal
              className="text-[var(--color-accent)]"
              size={16}
            />
          </div>
          <span className="font-bold tracking-tight text-sm text-[var(--color-text-primary)]">
            JSReverser CLI
          </span>
        </div>
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="p-2 rounded-lg bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
        >
          {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      {/* Sidebar Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[var(--color-bg-secondary)]/85 backdrop-blur-xl border-r border-[var(--color-border-default)] flex flex-col transition-transform duration-300 ease-in-out md:translate-x-0 md:static ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Logo */}
        <div className="h-16 flex items-center gap-3 px-6 border-b border-[var(--color-border-muted)]">
          <div className="w-8 h-8 rounded-xl bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 flex items-center justify-center shadow-lg shadow-black/10">
            <Terminal
              className="text-[var(--color-accent)]"
              size={16}
            />
          </div>
          <div>
            <span className="font-bold tracking-wider text-sm bg-gradient-to-r from-[var(--color-text-primary)] to-[var(--color-text-secondary)] bg-clip-text text-transparent">
              JSREVERSER
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] block font-mono">
              CONSOLE PANEL
            </span>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <NavLink
            to="/"
            onClick={() => setSidebarOpen(false)}
            className={getNavLinkClass}
          >
            <LayoutDashboard size={16} />
            <span>控制台概览</span>
          </NavLink>
          <NavLink
            to="/tools"
            onClick={() => setSidebarOpen(false)}
            className={getNavLinkClass}
          >
            <Wrench size={16} />
            <span>工具面板</span>
          </NavLink>
          <NavLink
            to="/hooks"
            onClick={() => setSidebarOpen(false)}
            className={getNavLinkClass}
          >
            <Radio size={16} />
            <span>Hook 监控点</span>
          </NavLink>
          <NavLink
            to="/site-experiences"
            onClick={() => setSidebarOpen(false)}
            className={getNavLinkClass}
          >
            <Globe size={16} />
            <span>站点经验</span>
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={getNavLinkClass}
          >
            <Settings size={16} />
            <span>连接设置</span>
          </NavLink>
        </nav>

        {/* Bottom copyright info */}
        <div className="p-6 border-t border-[var(--color-border-muted)] bg-[var(--color-bg-primary)]/20">
          <p className="text-[10px] text-[var(--color-text-muted)] font-mono text-center">
            &copy; 2026 JSReverser CLI
          </p>
        </div>
      </aside>

      {/* Backdrop overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Main Container */}
      <main className="flex-1 flex flex-col min-w-0 h-full pt-16 md:pt-0 overflow-hidden relative">
        <Routes>
          <Route
            path="/"
            element={<OverviewPage />}
          />
          <Route
            path="/tools"
            element={<ToolsPage />}
          />
          <Route
            path="/hooks"
            element={<HooksPage />}
          />
          <Route
            path="/site-experiences"
            element={<SiteExperiencesPage />}
          />
          <Route
            path="/settings"
            element={<SettingsPage />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    console.log('Connecting to WebSocket server...');
    wsClient.connect();
    return () => {
      console.log('Disconnecting from WebSocket server...');
      wsClient.disconnect();
    };
  }, []);

  return (
    <Router>
      <Layout />
    </Router>
  );
}
