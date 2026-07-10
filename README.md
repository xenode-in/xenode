# Xenode

Privacy-first, end-to-end encrypted cloud storage built with Next.js.

Xenode is an open-source storage platform for files, media, and shared albums where encryption happens on the client before data leaves the user's device. The server is responsible for authentication, metadata, realtime sync, billing, and storage coordination, while file contents remain encrypted end to end.

[![Version](https://img.shields.io/badge/version-0.1.0--beta.1-orange.svg)](./CHANGELOG.md)
[![Next.js](https://img.shields.io/badge/Next.js_16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![MongoDB](https://img.shields.io/badge/MongoDB-green?logo=mongodb)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-black?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

If Xenode is useful to you, please consider starring the repository ⭐. It helps more people discover the project and supports continued development.

## Overview

Xenode is designed for private cloud storage without giving the server plaintext access to user files. Files are encrypted in the browser, uploaded in chunks, stored in object storage, and decrypted only on authorized client devices. The product includes file management, media handling, encrypted sharing, album workflows, realtime updates, and self-hostable infrastructure.

This repository contains the Next.js application for Xenode.

## Features

- End-to-end encrypted file storage with client-side encryption and decryption.
- Chunked uploads for large files and direct object-storage integration.
- Secure file sharing with client-side key handling.
- On-device image optimization before upload.
- Video streaming capability for stored media.
- Album creation and album sharing.
- Realtime sync powered by Socket.IO and Redis.
- Authentication with Better Auth.
- Admin, billing, email, cron, and deployment support for production environments.

## Completed Work

The following core capabilities are already implemented:

- File encryption
- On-device image optimization
- Video streaming capability
- Album creation and sharing

## Roadmap

### Current Focus: Organization Support

The next major area of development is organization support. Planned work includes:

- Organization accounts and workspaces
- Team membership and invitations
- Role-based access control
- Shared storage ownership and administration
- Organization-level billing, limits, and policy controls
- Audit-friendly activity and access visibility

### Next: Client-Side ML Integration

After organization support, Xenode will focus on privacy-preserving machine learning features that run on the client side so the end-to-end encryption model remains intact.

Planned ML capabilities include:

- OCR for searchable text extraction from documents and images
- Face recognition for private media organization
- Client-side duplicate file detection
- Smart file classification and tagging
- Local-first media and document intelligence

These features should be designed so raw file contents, derived embeddings, and sensitive analysis outputs do not need to leave the user's device in plaintext.

## Architecture

| Layer          | Technology                                  |
| -------------- | ------------------------------------------- |
| Application    | Next.js 16, React 19, App Router            |
| Styling        | Tailwind CSS v4, Shadcn UI, Framer Motion   |
| Authentication | Better Auth                                 |
| Database       | MongoDB, Mongoose                           |
| Realtime       | Socket.IO, Redis                            |
| Storage        | Backblaze B2 / S3-compatible object storage |
| Uploads        | Uppy, multipart upload                      |
| Media          | FFmpeg WASM, Vidstack                       |
| Encryption     | Web Crypto API                              |
| Testing        | Vitest                                      |

## Encryption Model

Xenode follows a zero-knowledge design:

1. The client generates and manages encryption material in the browser.
2. Files are encrypted on the device before upload.
3. Object storage receives encrypted file data.
4. The server stores metadata and encrypted keys, but does not need plaintext file access.
5. Downloads and previews decrypt locally on authorized client devices.
6. Shared links rely on client-side key handling so secret material is not sent to the server as plaintext.

The long-term product direction keeps this principle intact, including upcoming ML features. Any OCR, face recognition, deduplication, or smart indexing work should run locally or use privacy-preserving client-side outputs.

## Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- MongoDB
- Redis
- Backblaze B2 or another S3-compatible storage provider

### Install

```bash
git clone https://github.com/xenode-in/xenode.git
cd xenode/xenode-nextjs
npm install
```

### Configure Environment

Copy the example environment file and update the values for your deployment.

```bash
cp .env.example .env.local
```

Minimum local configuration:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/xenode
MONGODB_LOGS_URI=mongodb://localhost:27017/xenode-logs
REDIS_URL=redis://localhost:6379

BETTER_AUTH_SECRET=change_me_to_a_random_32_plus_char_secret
ADMIN_USERNAME=superadmin
ADMIN_PASSWORD=change_me
ADMIN_JWT_SECRET=change_me_to_a_random_32_plus_char_secret

S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
S3_REGION=us-west-004
S3_KEY_ID=your_storage_key_id
S3_APPLICATION_KEY=your_storage_application_key
S3_BUCKET_NAME=your_private_bucket_name

PUBLIC_S3_BUCKET=your_public_bucket_name
PUBLIC_S3_ENDPOINT=https://your-public-storage-endpoint

RESEND_API_KEY=
CRON_SECRET=change_me_to_a_random_secret
```

Optional integrations include Google OAuth, GitHub OAuth, PostHog analytics, and Razorpay billing. See `.env.example` and `docker-compose.yaml` for the full list of supported variables.

### Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
npm run build
npm run start
```

The production server runs through `server.mjs`, which starts Next.js and Socket.IO together.

## Self-Hosting

Xenode can be self-hosted on any platform that supports Node.js, MongoDB, Redis, and S3-compatible object storage. Docker-based hosting is recommended for production.

### Option 1: Docker Compose

1. Create a `.env` file next to `docker-compose.yaml`.
2. Fill in the required values for app URL, MongoDB, Redis, auth secrets, admin credentials, storage, email, cron, and billing if enabled.
3. Start the stack:

```bash
docker compose up -d --build
```

The compose file runs:

- The Xenode Next.js app on port `3000`
- A cron sidecar for scheduled maintenance jobs
- External MongoDB, Redis, and object storage connections supplied by environment variables

For production, put the app behind a reverse proxy such as Caddy, Nginx, Traefik, Coolify, or a managed platform proxy. Configure HTTPS and set `NEXT_PUBLIC_APP_URL` to the public URL.

### Option 2: Manual Node.js Deployment

1. Provision MongoDB, Redis, and S3-compatible storage.
2. Clone the repository on the server.
3. Install dependencies with `npm install`.
4. Configure `.env.local` or platform environment variables.
5. Build the app with `npm run build`.
6. Start the production server with `npm run start`.

Use a process manager such as systemd, PM2, Docker, or your platform's native process supervisor to keep the server running.

### Operational Notes

- Use strong random secrets for `BETTER_AUTH_SECRET`, `ADMIN_JWT_SECRET`, `REALTIME_TOKEN_SECRET`, and `CRON_SECRET`.
- Keep MongoDB, Redis, and object storage private wherever possible.
- Configure bucket CORS rules so browser uploads and downloads work from your public app URL.
- Run scheduled cron endpoints with the `CRON_SECRET` bearer token.
- Back up MongoDB and object storage regularly.
- Review billing, email, and analytics variables before enabling those features in production.

## Scripts

```bash
npm run dev            # Start the local Next.js + Socket.IO server
npm run build          # Create a production build
npm run start          # Start the production server
npm run lint           # Run ESLint
npm run test           # Run Vitest
npm run test:coverage  # Run tests with coverage
```

## Contributing

Contributions are welcome. Please open an issue for significant changes before starting implementation, keep pull requests focused, and include tests for behavior that affects encryption, storage, sharing, billing, or organization workflows.

## License

Xenode is released under the [MIT License](./LICENSE). You are free to use, modify, distribute, and use the project commercially under the terms of the license.

If you use Xenode commercially, we would appreciate it if you let us know. This is an optional courtesy request and does not change the MIT license terms.
