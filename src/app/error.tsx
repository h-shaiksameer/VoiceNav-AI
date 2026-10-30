"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="fatal-error"><AlertTriangle size={32} /><h1>Something interrupted your journey.</h1><p>The application encountered an unexpected error. Reload the view to try again.</p><button className="primary-button" onClick={reset}><RotateCcw size={16} />Try again</button></main>;
}