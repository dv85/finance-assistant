import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Finance Assistant",
  icons: { icon: "/icon.svg" },
  description: "A local household dashboard for cashflow, budgets, and spending.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
