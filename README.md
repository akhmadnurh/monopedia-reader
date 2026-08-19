# 📚 Monopedia Reader

**Monopedia Reader** is a modern, lightweight, and local-first Progressive Web App (PWA) e-book reader built for PDF and EPUB formats. Designed with a Bring-Your-Own-Storage (BYOS) philosophy, it syncs your library and reading progress seamlessly across devices using your own Google Drive storage.

![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-svg&logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-svg&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue?style=flat-svg&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=flat-svg&logo=tailwind-css)
![PWA](https://img.shields.io/badge/PWA-Serwist-purple?style=flat-svg)

---

## ✨ Key Features

- 📖 **Universal Format Support:** Seamlessly read `.pdf` and `.epub` files with optimized canvas rendering.
- 🔄 **Google Drive Sync (BYOS):** Keep your books, metadata, and reading progress synchronized across all your devices using your private Google Drive folder (`/Monopedia Reader`).
- ⚡ **Local-First & Offline Ready:** Powered by IndexedDB (Dexie.js). Your downloaded books remain 100% accessible even when you are offline.
- 📱 **Mobile-Optimized Experience:** Fully responsive layout with gesture navigation (swipe to flip pages, tap zones) and adaptive mobile UI elements.
- 🎯 **Smart Zoom & Pan Engine:** Auto-fit width calculation to eliminate horizontal scrolling on mobile, with smooth multi-directional panning when zoomed in.
- 🔀 **Dual Reading Modes:** Switch effortlessly between **Single Page** pagination and **Continuous Scroll** modes.
- 🔍 **Library Management:** Filter by reading status (*All, Reading, Unread, Finished*), search by title/author, and sort by recent activity or title.
- 🔒 **Privacy Focused:** Your data stays on your device and inside your personal Google Drive. No external application servers tracking your reading habits.

---

## 🛠️ Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router)
- **Language:** [TypeScript](https://www.typescriptlang.org/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Database (Local):** [Dexie.js](https://dexie.org/) (IndexedDB wrapper)
- **PDF Engine:** `pdfjs-dist`
- **EPUB Engine:** `epubjs` / `foliate-js`
- **Cloud API:** Google Drive REST API v3
- **State & Hooks:** React Hooks & `dexie-react-hooks` (`useLiveQuery`)

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or later
- npm / pnpm / yarn
- A Google Cloud Console Project with **Google Drive API** enabled and OAuth 2.0 Client ID configured.

### Installation

1. Clone the repository:
<pre><code>git clone https://github.com/akhmadnurh/monopedia-reader.git
cd monopedia-reader</code></pre>

2. Install dependencies:
<pre><code>npm install</code></pre>

3. Set up environment variables:
Create a <code>.env.local</code> file in the root directory:
<pre><code>NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id_here</code></pre>

4. Run the development server:
<pre><code>npm run dev</code></pre>

Open http://localhost:3000 in your browser.

---

## 🔧 Google Drive Setup

1. Go to the <a href="https://console.cloud.google.com/">Google Cloud Console</a>.
2. Create a new project and enable the <strong>Google Drive API</strong>.
3. Configure the <strong>OAuth Consent Screen</strong>:
   <ul>
     <li>Choose <strong>External</strong> user type.</li>
     <li>Add your Gmail account under <strong>Test Users</strong>.</li>
     <li>Add scope: <code>https://www.googleapis.com/auth/drive.file</code></li>
   </ul>
4. Create <strong>OAuth 2.0 Client IDs</strong> (Application type: <em>Web application</em>).
5. Add <code>http://localhost:3000</code> (and your production domain) to <strong>Authorized JavaScript origins</strong> and <strong>Authorized redirect URIs</strong>.
6. Copy the generated <strong>Client ID</strong> and paste it into your <code>.env.local</code> file.

---

## 📱 PWA Installation Guide

### Android (Google Chrome)
1. Open the app URL in Chrome.
2. Tap the Install App banner at the bottom or open the menu (⋮) -> select Install app / Add to Home screen.

### iOS / iPhone (Safari)
1. Open the app URL in Safari.
2. Tap the Share button at the bottom navigation bar.
3. Scroll down and select Add to Home Screen.

### Desktop (Chrome / Edge)
1. Open the app URL in Chrome or Edge.
2. Click the Install icon on the right side of the address bar (omnibox).

---

## 📄 License

This project is open-source and available under the MIT License.