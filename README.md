# Xenode

> **Privacy-first, End-to-End Encrypted cloud storage — built in the open.**

Xenode is a modern, open-source cloud storage platform where **only you can read your files**. Everything is encrypted in your browser before it ever leaves your device. The server sees nothing but locked ciphertext — not your files, not their names, not your passwords.

[![Next.js](https://img.shields.io/badge/Next.js_15-black?logo=next.js)](https://nextjs.org)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![MongoDB](https://img.shields.io/badge/MongoDB-green?logo=mongodb)](https://mongodb.com)

---

## ✨ What Makes Xenode Different

- 🔐 **True Zero-Knowledge** — your private key never leaves your browser. We literally cannot read your files.
- 🗂️ **Bucket-based organization** — group files into isolated, encrypted buckets.
- 🔗 **Secure sharing** — share any file via a link. The decryption key travels in the URL fragment (never sent to the server).
- ⚡ **Fast, chunked uploads** — large files upload directly to Backblaze B2 without passing through the server.
- 🌐 **Self-hostable** — run your own Xenode instance with your own storage backend.

---

## 🚀 Tech Stack

| Layer              | Technology                                   |
| ------------------ | -------------------------------------------- |
| Frontend & Backend | Next.js 15 (App Router), React 19            |
| Styling            | Tailwind CSS v4, Shadcn UI, Framer Motion    |
| Auth               | Better Auth                                  |
| Database           | MongoDB + Mongoose                           |
| Storage            | Backblaze B2 (S3-compatible)                 |
| Encryption         | Web Crypto API (AES-256-GCM + RSA-OAEP 4096) |
| Uploads            | Uppy (multipart / direct-to-S3)              |

---

## 🔒 How the Encryption Works

Xenode uses a **hybrid encryption model** — fast symmetric encryption for files, protected by your asymmetric key pair.

1. **On signup**, your browser generates an RSA-4096 key pair. The private key is encrypted with a key derived from your password and stored in our database — still encrypted. We never see your private key.
2. **On login**, your password re-derives the master key, which decrypts your private key _in your browser only_.
3. **On upload**, a unique AES-256 key is generated per file, used to encrypt the file, then itself encrypted with your public key. Only the encrypted file and the encrypted key are stored.
4. **On download**, your private key (in memory) unwraps the file's AES key, and the file is decrypted locally.
5. **On sharing**, a separate share key is generated and embedded in the URL hash (`#key=...`). URL hashes are never sent to any server, so the share key stays client-side only.

> **Bottom line:** Xenode's servers only ever store encrypted blobs. Even if our database were breached, your files remain unreadable.

---

## 🛠️ Getting Started

### Prerequisites

- **Node.js** v18+
- **MongoDB** (local or [MongoDB Atlas](https://www.mongodb.com/atlas))
- **Backblaze B2** account ([free tier available](https://www.backblaze.com/b2/cloud-storage.html))

### 1. Clone & Install

```bash
git clone https://github.com/xenode-in/xenode.git
cd xenode
npm install
```

### 2. Configure Environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env.local
```

```env
# Database
MONGODB_URI=your_mongodb_connection_string

# Better Auth
BETTER_AUTH_SECRET=your_secret_key
BETTER_AUTH_URL=http://localhost:3000

# Backblaze B2 (S3-compatible)
S3_ENDPOINT=your_b2_s3_endpoint
S3_REGION=your_b2_region
S3_APPLICATION_KEY_ID=your_key_id
S3_APPLICATION_KEY=your_app_key
S3_BUCKET_NAME=your_bucket_name
```

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and you're good to go.

---

## 🤝 Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change. Pull requests should target the `main` branch.

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Commit your changes
4. Open a pull request

---

## 📜 License

[MIT](./LICENSE) — free to use, self-host, and build upon.
