import type { ReactNode } from 'react';
export const metadata = { title: 'OpenAgent receiver', description: 'Verify broker-issued agent capabilities.' };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
