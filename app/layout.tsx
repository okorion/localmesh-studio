import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://localmesh-studio.okorion.chatgpt.site";
const SITE_DESCRIPTION =
  "WebGPU와 로컬 AI를 사용하는 로컬 우선 실시간 협업 3D 편집기";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "LocalMesh Studio",
    template: "%s · LocalMesh Studio",
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    siteName: "LocalMesh Studio",
    title: "LocalMesh Studio",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "LocalMesh Studio — Local AI, WebGPU, Yjs",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "LocalMesh Studio",
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
