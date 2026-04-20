import './globals.css';

export const metadata = {
  title: 'Chessr v3 — Admin Dashboard',
  description: 'Beta admin tools for the Chessr v3 stack',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
