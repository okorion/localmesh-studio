import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "LocalMesh Studio",
    template: "%s · LocalMesh Studio",
  },
  description:
    "WebGPU와 로컬 AI를 사용하는 로컬 우선 실시간 협업 3D 편집기",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
