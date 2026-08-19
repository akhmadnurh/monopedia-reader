"use client";

import { SerwistProvider as SerwistProviderInner } from "@serwist/turbopack/react";

export function SerwistProvider({ children }: { children: React.ReactNode }) {
  return (
    <SerwistProviderInner swUrl="/serwist/sw.js" register reloadOnOnline>
      {children}
    </SerwistProviderInner>
  );
}
