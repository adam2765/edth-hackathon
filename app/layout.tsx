import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice-to-Map",
  description: "Spoken position reports to live map updates, with ask-back when a report is ambiguous.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f1720",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
