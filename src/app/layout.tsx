import type { Metadata } from "next";
import { Lora, Poppins } from "next/font/google";
import "./globals.css";

/**
 * Self-hosted by next/font. The prototype pulled these through an `@import`
 * inside an inline <style>, which blocks first paint on a screen whose whole
 * point is to feel calm and immediate.
 */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["500", "600"],
  display: "swap",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Minimum Stress",
  description:
    "Private rooms by the hour for every kind of practice — movement, coaching, meditation, and healing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${lora.variable} ${poppins.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
