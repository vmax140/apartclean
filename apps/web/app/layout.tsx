import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { DEFAULT_LOCALE, t } from '@apartclean/shared';
import './globals.css';

// Jedan font na webu i telefonu (SPEC sekcija 7 „Dizajn").
const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: t('app.name', DEFAULT_LOCALE),
  description: t('app.description', DEFAULT_LOCALE),
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#11141c' },
  ],
};

// Postavlja temu pre prvog iscrtavanja, da ne bude belog bleska u tamnom režimu.
const themeScript = `(function(){try{var s=localStorage.getItem('theme');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sr-Latn" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${inter.variable} font-sans`}>{children}</body>
    </html>
  );
}
