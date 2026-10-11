import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'SocialBoost Admin',
  description: 'Users, coins, orders and code catalogue.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
