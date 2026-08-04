# StegFr
StegFr is an AI-assisted image steganography platform that securely hides encrypted messages inside images. It combines classical image analysis, a CNN-based suitability scorer, reinforcement learning optimization, and Fernet encryption to improve embedding quality while preserving image appearance.

## Features
- Secure message encryption using Fernet (AES + HMAC)
- AI-guided region selection for embedding
- Reinforcement learning-based embedding optimization
- Deterministic message extraction
- Real-time chat module with authentication
- Browser-based implementation using TensorFlow.js

## How It Works
1. The uploaded image is analyzed and passed through a CNN-based scorer to identify regions best suited for embedding (balancing capacity and imperceptibility)
2. A reinforcement learning agent optimizes the embedding strategy within the selected regions
3. The secret message is encrypted (Fernet: AES + HMAC) before embedding
4. The stego-image is generated with minimal visual distortion, and the message can be deterministically extracted using the correct key

## Tech Stack
- React 18
- TypeScript
- TensorFlow.js
- Tailwind CSS
- Supabase
- Web Crypto API

## Installation
git clone <repository-url>
cd stegfr
npm install
npm run dev

## Security
* AES-128-CBC Encryption
* HMAC-SHA256 Authentication
* PBKDF2 Key Derivation

## Contributors
- Sanjana N
- Sonika Satya Reddy
- Shaik Insha Tanveer# StegFr
StegFr is an AI-assisted image steganography platform that securely hides encrypted messages inside images. It combines classical image analysis, a CNN-based suitability scorer, reinforcement learning optimization, and Fernet encryption to improve embedding quality while preserving image appearance.

## Note
StegFr is intended for educational and research purposes.
