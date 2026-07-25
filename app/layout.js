import './globals.css';

export const metadata = {
  title: 'Link Shortener + WhatsApp Click Tracking',
  description: 'Create short links per mobile number and track clicks.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
