import { Geist, Geist_Mono } from "next/font/google";
import "highlight.js/styles/github-dark.css";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  metadataBase: new URL("https://elviscode.vercel.app"),
  applicationName: "ElvisCode",
  title: {
    default: "ElvisCode — Your AI Workspace for Building",
    template: "%s | ElvisCode",
  },
  description:
    "A focused AI workspace for software development, web research, code analysis, and secure sandboxed JavaScript and Python execution.",
  keywords: [
    "AI coding assistant",
    "JavaScript",
    "Python",
    "software development",
    "code analysis",
    "web research",
    "developer tools",
  ],
  openGraph: {
    type: "website",
    url: "https://elviscode.vercel.app",
    siteName: "ElvisCode",
    title: "ElvisCode — Your AI Workspace for Building",
    description:
      "Think, build, research, and test code in one focused AI workspace.",
  },
  twitter: {
    card: "summary",
    title: "ElvisCode — Your AI Workspace for Building",
    description:
      "Think, build, research, and test code in one focused AI workspace.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
