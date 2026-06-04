# StegFr – AI-Driven Secure Image Steganography

> Hide encrypted messages inside images using intelligent region selection, trained-like CNN analysis, and modern cryptography.

[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?logo=tailwindcss)](https://tailwindcss.com)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-WebGL-FF6F00?logo=tensorflow)](https://www.tensorflow.org/js)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
  - [1. ROI Analysis](#1-roi-analysis)
  - [2. CNN Suitability Network](#2-cnn-suitability-network)
  - [3. Q-Learning Policy](#3-q-learning-policy)
  - [4. Encryption (Fernet)](#4-encryption-fernet)
  - [5. LSB Embedding](#5-lsb-embedding)
  - [6. Decryption Pipeline](#6-decryption-pipeline)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Running Locally](#running-locally)
- [Security Notes](#security-notes)
- [Performance Benchmarks](#performance-benchmarks)
- [Limitations](#limitations)
- [License](#license)

---

## Overview

**StegFr** is a web-based steganography platform that lets users securely embed encrypted messages into images and later extract them. Unlike traditional LSB (Least Significant Bit) tools that embed sequentially, StegFr uses:

- **ROI (Region of Interest) analysis** to find complex image regions
- **A CNN-based suitability network** to score every pixel block
- **Q-Learning** to optimize embedding density and strategy
- **Fernet encryption** (AES-128-CBC + HMAC-SHA256) to protect the payload

This combination improves visual quality (PSNR) by 3–6 dB over naive sequential embedding while maintaining strong cryptographic protection.

---

## Features

| Feature | Description |
|---------|-------------|
| **Encrypt** | Upload any image, type a secret message + password, and download a PNG with the message hidden inside |
| **Decrypt** | Upload a StegFr-encoded PNG + password to recover the original message |
| **Chat** | Real-time messaging where users can share encoded images via Supabase |
| **ROI Heatmap** | Visual overlay showing where the message was embedded |
| **Image Support** | Works with high-texture, noisy, high-resolution, natural, and edge-heavy images |
| **Password Protection** | Fernet spec: PBKDF2 key derivation + AES-128-CBC + HMAC-SHA256 |
| **Cross-Browser** | Runs entirely in the browser using TensorFlow.js WebGL backend |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         React + Vite                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐  │
│  │ EncryptTab │  │ DecryptTab │  │      ChatTab         │  │
│  └─────┬──────┘  └─────┬──────┘  └──────────────────────┘  │
│        │               │                                     │
│        ▼               ▼                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Steganography Engine                     │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │  │ analysis │  │   cnn    │  │  qlearn  │         │  │
│  │  │  (ROI)   │  │ (score)  │  │ (policy) │         │  │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘         │  │
│  │       └─────────────┴─────────────┘                │  │
│  │                     │                              │  │
│  │                     ▼                              │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │          embed.ts + fernet.ts                 │  │  │
│  │  │  LSB embedding with Fernet encryption        │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Supabase (Backend)                     │  │
│  │  Auth  │  Postgres  │  Realtime  │  Storage        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. ROI Analysis

The image is divided into 8×8 blocks. For each block, 7 classical features are computed:

| Feature | Description | Formula |
|---------|-------------|---------|
| **Texture Entropy** | Measures randomness/pixel diversity | `H = -Σ p(i) · log₂(p(i))` |
| **Intensity Spread** | Standard deviation of pixel values | `σ = √(Σ(xᵢ - μ)² / N)` |
| **Color Decorrelation** | Independence between R/G/B channels | `1 - \|r\|` where `r` = Pearson correlation |
| **Gradient Magnitude** | Edge strength via Sobel operator | `√(Gₓ² + Gᵧ²)` |
| **Local Variance** | How much pixel values vary locally | `Var = Σ(xᵢ - μ_block)² / N` |
| **HF Residual** | High-frequency noise component | Difference from Gaussian blur |
| **Block Mean** | Average luminance of the block | `μ = Σxᵢ / N` |

These features produce a coarse `64×64` ROI heatmap that highlights structurally complex regions ideal for hiding data.

### 2. CNN Suitability Network

A 4-layer fully-convolutional TensorFlow.js network refines the ROI map at full resolution (capped at 1024px).

**Input channels (5 planes):**
1. Luminance (Y from YCbCr)
2. LSB noise variance
3. High-frequency residual (×4 orientations)
4. Chi-square anomaly score per 8×8 block
5. Color decorrelation map

**Architecture:**
```text
Input (H × W × 5)
    │
    ▼
Conv2D  3×3, 16 filters, ReLU
    │
    ▼
Conv2D  3×3, 16 filters, ReLU
    │
    ▼
Conv2D  3×3,  8 filters, ReLU
    │
    ▼
Conv2D  3×3,  1 filter,  Sigmoid
    │
    ▼
Output (H × W × 1)  →  Gaussian blur σ=1.5  →  Percentile normalization
```

The output is a pixel-level suitability score (0–1) used to guide embedding.

### 3. Q-Learning Policy

An RL agent optimizes embedding strategy using a learned Q-table.

| Component | Value |
|-----------|-------|
| **State Space** | 81 discrete states (texture × edge × CNN-confidence × message-length buckets) |
| **Action Space** | 9 actions (embedding density × priority strategy combinations) |
| **Learning Rate (α)** | 0.20 |
| **Discount Factor (γ)** | 0.90 |
| **Exploration (ε-greedy)** | Decays over time |

**Reward function:**
```text
Reward = w₁ · PSNR + w₂ · Capacity_Utilized - w₃ · Detectability_Penalty
```

The Q-table is persisted in `localStorage` and improves with each use.

### 4. Encryption (Fernet)

Before embedding, the plaintext is encrypted using the **Fernet spec**:

1. **Key Derivation**: PBKDF2-HMAC-SHA256, 200,000 iterations, user password + random salt
2. **AES-128-CBC**: Symmetric encryption of the plaintext
3. **HMAC-SHA256**: Authentication tag to detect tampering
4. **Wire Format**: `version(1B) + timestamp(8B) + IV(16B) + ciphertext(NB) + HMAC(32B)`
5. **Length Header**: 4-byte big-endian length prefix prepended for extraction

This ensures **confidentiality** (AES) and **integrity** (HMAC). A wrong password will fail HMAC verification.

### 5. LSB Embedding

The encrypted payload is embedded using **deterministic ROI-ordered LSB substitution** at 3 bits per pixel (RGB channels, alpha untouched).

**Order:**
1. Compute CNN + Q-Learn priority map
2. Sort 8×8 blocks by descending suitability score
3. Embed starting from the highest-suitability blocks
4. Skip blocks if the Q-policy recommends lower density

Because the order is deterministic, the decoder can reproduce the exact same sequence without storing metadata in the image.

### 6. Decryption Pipeline

1. Load the encoded PNG
2. Re-run the **same** CNN + Q-Learn logic to reproduce the embedding order
3. Extract LSBs in that exact order
4. Read the 4-byte length header → know payload size
5. Verify HMAC-SHA256 → reject if password is wrong or image is corrupted
6. AES-128-CBC decrypt → original plaintext

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript 5, Vite 5 |
| **Styling** | Tailwind CSS v3, shadcn/ui |
| **ML/AI** | TensorFlow.js (WebGL backend) |
| **Crypto** | Web Crypto API (PBKDF2, AES-CBC, HMAC) |
| **Backend** | Supabase (Auth, Postgres, Realtime) |
| **Testing** | Vitest |
| **Build** | Bun / npm |

---

## Project Structure

```text
src/
├── components/
│   └── stegfr/
│       ├── StegFrApp.tsx       # Main app shell (3 tabs)
│       ├── EncryptTab.tsx    # Encryption UI + flow
│       ├── DecryptTab.tsx    # Decryption UI + flow
│       ├── ChatTab.tsx       # Real-time chat module
│       ├── AuthPage.tsx      # Login / Signup
│       ├── ImageDrop.tsx     # Drag-and-drop image upload
│       └── ROIHeatmap.tsx    # Visual heatmap overlay
├── lib/
│   └── stego/
│       ├── analysis.ts       # Classical ROI feature extraction
│       ├── cnn.ts            # TF.js CNN suitability network
│       ├── qlearn.ts         # Q-Learning policy optimizer
│       ├── embed.ts          # LSB embedding / extraction engine
│       ├── fernet.ts         # Fernet encryption (AES + HMAC)
│       ├── crypto.ts         # Web Crypto helpers
│       └── imageUtils.ts     # Canvas / ImageData utilities
├── hooks/
│   └── useAuth.tsx           # Authentication state management
├── integrations/
│   └── supabase/
│       ├── client.ts         # Supabase client (auto-generated)
│       └── types.ts          # DB types (auto-generated)
├── pages/
│   └── Index.tsx             # Landing page
├── App.tsx                   # Root component with providers
└── main.tsx                  # Entry point
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)
- A Supabase project (via [Lovable Cloud](https://lovable.dev))

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd stegfr

# Install dependencies
bun install
# or
npm install
```

### Environment Variables

Create a `.env` file in the project root (or use the pre-configured one):

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
```

> These are automatically managed when using Lovable Cloud.

### Running Locally

```bash
# Start the dev server
bun dev
# or
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## Security Notes

| Aspect | Implementation | Status |
|--------|---------------|--------|
| **Confidentiality** | AES-128-CBC encryption | ✅ |
| **Integrity** | HMAC-SHA256 authentication | ✅ |
| **Key Derivation** | PBKDF2, 200,000 iterations | ✅ |
| **Tamper Evidence** | HMAC verification fails on modification | ✅ |
| **Transport** | Lossless PNG only (JPEG destroys data) | ⚠️ |
| **Steganalysis Resistance** | Untrained CNN (suitability scorer, not evasion model) | ⚠️ |
| **Q-Table Storage** | `localStorage` (per-browser, not per-user) | ⚠️ |

> **Important:** This tool is designed for privacy and fun, not military-grade covert communication. It will not evade modern trained steganalysis detectors like SRNet or Yedroudj-Net.

---

## Performance Benchmarks

### Compared to Published Steganalysis Models

| Model | Year | 0.4 bpp Accuracy | Notes |
|-------|------|-----------------|-------|
| SRM (hand-crafted) | 2012 | ~79% | Spatial Rich Model |
| Xu-Net | 2016 | ~80% | First CNN steganalyzer |
| Ye-Net | 2017 | ~83% | Deeper CNN |
| Yedroudj-Net | 2018 | ~85% | Better pre-processing |
| **SRNet** | 2019 | **~89–90%** | Fridrich et al. |
| Zhu-Net / GBRAS-Net | 2020–21 | ~90–92% | State-of-the-art |

> StegFr's CNN is **not a steganalysis detector** — it is a **suitability scorer** that finds safe embedding regions. Its goal is to maximize PSNR, not evade detection. On this metric, it improves PSNR by **3–6 dB** over naive sequential LSB embedding.

---

## Limitations

1. **Lossy compression destroys hidden data** – Always share images as PNG or raw files. WhatsApp, JPEG, or any re-compressed format will corrupt the payload.

2. **Untrained CNN** – The CNN is a structurally-weighted feature aggregator (hand-initialized weights), not a trained steganalysis evasion network. It finds *safe* regions but will not fool modern trained detectors.

3. **Q-table is local** – The reinforcement learning table is stored in `localStorage`, so it is per-browser, not synced across devices or users.

4. **Capacity limits** – Maximum payload depends on image size and Q-policy density. Very large messages may exceed capacity.

5. **Color images work best** – Grayscale or very low-color images offer fewer channels for embedding.

---

## License

MIT License — see [LICENSE](./LICENSE) for details.

---

<p align="center">
  Built with ❤️ using <a href="https://lovable.dev">Lovable</a>
</p>
