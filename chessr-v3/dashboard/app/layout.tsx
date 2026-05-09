import './globals.css';

export const metadata = {
  title: 'chessr.io — Dashboard',
  description: 'Admin tools for chessr.io',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
