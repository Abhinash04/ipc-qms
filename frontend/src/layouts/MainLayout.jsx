import { Outlet } from "react-router-dom";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { ScrollingMarquee } from "@/components/common/ScrollingMarquee";
import { MailboxAutoSync } from "@/components/workflow/MailboxAutoSync";
import { WorkflowRevalidation } from "@/components/workflow/WorkflowRevalidation";
import { MobileNav } from "@/components/layout/MobileNav";
import { PageBackdrop } from "@/components/common/PageBackdrop";

export function MainLayout() {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="relative isolate flex h-screen overflow-hidden bg-surface-muted text-ink">
          <PageBackdrop />
          <MailboxAutoSync />
          <WorkflowRevalidation />
          <Sidebar />
          <div
            id="main-scroll"
            className="relative z-20 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          >
            <Header />
            <ScrollingMarquee />
            <main className="relative z-10 flex-1 px-4 pt-6 pb-8 lg:px-7">
              <Outlet />
            </main>
            <Footer />
          </div>
          <MobileNav />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
