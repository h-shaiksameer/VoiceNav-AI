import Link from "next/link";

export default function NotFound() {
  return <main className="fatal-error"><h1>Page not found</h1><Link className="primary-button" href="/">Return to VoiceNav</Link></main>;
}