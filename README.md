<p align="center">
  <img src="https://via.placeholder.com/800x400/0d1117/58a6ff?text=Traffic+Management+3D" width="100%" />
</p>

<h1 align="center">Traffic Management Plan 3D</h1>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Three.js-000000?style=flat-square&logo=three.js" />
  <img src="https://img.shields.io/badge/Gemini_API-4285F4?style=flat-square&logo=google" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=flat-square&logo=vercel" />
</p>

<p align="center">
  An interactive 3D traffic visualization dashboard powered by Google Gemini API for intelligent traffic flow analysis and urban planning.
</p>

---

## Features

-  Real-time 3D map visualization of traffic patterns
-  AI-powered traffic analysis using Gemini API
-  Interactive controls for zoom, rotation, and data filtering
-  Responsive design for desktop and mobile

## Demo

**Live:** [View Live Demo](https://marg-rakshak.vercel.app)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/divyanshu-bit/Traffic-Management-Plan_3D.git
cd Traffic-Management-Plan_3D

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Add your GEMINI_API_KEY to .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Your Google Gemini API key |

## Tech Stack

- **Frontend:** JavaScript, Three.js, HTML5, CSS3
- **AI:** Google Gemini API
- **Build:** Vite
- **Deployment:** Vercel

## Project Structure

```
├── client_src/     # Client-side source files
├── public/         # Static assets
├── scripts/        # Build and utility scripts
├── server/         # Backend server logic
├── src/            # Main source code
└── output/         # Generated outputs
```

## License

MIT
