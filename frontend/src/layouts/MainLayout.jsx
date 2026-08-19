import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export function MainLayout() {
  return (
    <div className="flex h-screen bg-[#f1f5f9]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-[28px] pb-[48px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
