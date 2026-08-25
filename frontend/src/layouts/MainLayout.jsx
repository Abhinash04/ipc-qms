import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export function MainLayout() {
  return (
    <div className="app-shell-aurora relative flex h-screen overflow-hidden bg-transparent">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[18%] top-[8%] h-56 w-56 rounded-full bg-blue-300/18 blur-3xl" />
        <div className="absolute right-[12%] top-[10%] h-64 w-64 rounded-full bg-violet-300/16 blur-3xl" />
        <div className="absolute bottom-[8%] right-[24%] h-72 w-72 rounded-full bg-cyan-200/18 blur-3xl" />
      </div>
      <Sidebar />
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="relative flex-1 overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

