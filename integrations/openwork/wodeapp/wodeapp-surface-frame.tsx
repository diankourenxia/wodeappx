/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import "./wodeapp-surfaces.css";

type WodeAppSurfaceFrameProps = {
  title: string;
  subtitle: string;
  Icon: LucideIcon;
  children: ReactNode;
};

export function WodeAppSurfaceFrame({ title, subtitle, Icon, children }: WodeAppSurfaceFrameProps) {
  return (
    <section className="wx-surface-frame">
      <header>
        <div className="wx-surface-icon">
          <Icon aria-hidden />
        </div>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

