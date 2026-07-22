import type { Metadata } from "next";
import { Inter, Geist_Mono, Anton, DM_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Landing-page-only faces (Caldera-style): Anton = condensed ultrabold display,
// DM Sans 500 = body. The app itself stays on Inter.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  weight: ["500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Glinton — AI & search visibility",
  description:
    "Measures how often a company shows up in AI answers (ChatGPT, Gemini, Google AI Overview), how it ranks against competitors, and what to do about it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} ${anton.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: "document.body.classList.add('reveal-ready')",
          }}
        />
        {children}
      </body>
    </html>
  );
}
