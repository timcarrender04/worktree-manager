'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';

export function MainContent({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(256); // Default 64 * 4 (w-64)
  const { user, loading } = useAuth();

  useEffect(() => {
    // Check sidebar state from localStorage
    const checkSidebarState = () => {
      // If user is not authenticated, sidebar should not be visible
      if (!loading && !user) {
        setSidebarWidth(0);
        return;
      }
      
      const saved = localStorage.getItem('sidebarCollapsed');
      const isCollapsed = saved ? JSON.parse(saved) : false;
      setSidebarWidth(isCollapsed ? 64 : 256); // 64px when collapsed, 256px when expanded
    };

    // Check on mount
    checkSidebarState();

    // Listen for storage changes (when sidebar state changes)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'sidebarCollapsed') {
        checkSidebarState();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Also listen for custom event from Sidebar component
    const handleSidebarToggle = () => {
      checkSidebarState();
    };

    window.addEventListener('sidebarToggle', handleSidebarToggle);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sidebarToggle', handleSidebarToggle);
    };
  }, [user, loading]);

  // Update sidebar width when auth state changes
  useEffect(() => {
    if (!loading && !user) {
      setSidebarWidth(0);
    } else if (!loading && user) {
      const saved = localStorage.getItem('sidebarCollapsed');
      const isCollapsed = saved ? JSON.parse(saved) : false;
      setSidebarWidth(isCollapsed ? 64 : 256);
    }
  }, [user, loading]);

  return (
    <>
      {/* Desktop: with sidebar margin */}
      <main 
        className="flex-1 overflow-y-auto transition-all duration-300 hidden lg:block bg-[var(--background-alt)]"
        style={{ marginLeft: `${sidebarWidth}px` }}
      >
        <div className="min-h-screen py-4 sm:py-8 px-4 sm:px-6">
          {children}
        </div>
      </main>
      {/* Mobile: full width (sidebar is separate toggle) */}
      <main className="flex-1 overflow-y-auto lg:hidden bg-[var(--background-alt)]">
        <div className="min-h-screen py-3 sm:py-6 lg:py-8 px-3 sm:px-4 lg:px-6">
          {children}
        </div>
      </main>
    </>
  );
}
