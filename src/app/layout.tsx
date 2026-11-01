import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: `${process.env.APP_NAME || "VoiceNav AI"} | Your Journey, In Conversation`,
  description: "A voice-first route planner built on OpenStreetMap. Real routes and places, with explicit destination control.",
  applicationName: process.env.APP_NAME || "VoiceNav AI",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<Analytics /></body></html>;
}