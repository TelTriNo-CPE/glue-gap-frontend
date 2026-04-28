# Glue Gap Analyser - Frontend

A high-performance web application for detecting and analysing glue gaps in large-scale images. Built with React 19, Vite, and OpenSeadragon for smooth interaction with deep-zoom image tiles.

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: Version 18.0 or higher
- **pnpm**: Recommended package manager (Standard `npm` or `yarn` also work, but `pnpm-lock.yaml` is provided)

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd glue-gap-frontend
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

### Running for Development

1. **Start the development server:**
   ```bash
   pnpm dev
   ```
2. Open your browser and navigate to `http://localhost:5173`.

> **Note on Backends:** This frontend application requires two backend services to be running for full functionality:
> - **API Gateway / Metadata Service**: Should be running on `http://localhost:3030`.
> - **Image Processor / AI Service**: Should be running on `http://localhost:8080`.
>
> The Vite development server is configured to proxy requests to these ports automatically.

---

## 🛠️ Features

- **Deep Zoom Viewer**: Seamlessly navigate gigapixel-scale images using OpenSeadragon.
- **AI-Powered Detection**: Automatic identification of glue gaps using backend computer vision models.
- **Manual Refinement Tools**: Comprehensive toolset including Brush, Eraser, Magic Wand, Lasso, and Split tools for perfecting results.
- **History Management**: Robust Undo/Redo system (`Ctrl+Z`, `Ctrl+Y`) for all manual modifications.
- **Version Control**: Compare different detection parameters by creating and switching between analysis versions.
- **Multi-Format Export**: Export annotated images (JPEG/PNG) or detailed reports in Excel (.xlsx) with embedded thumbnails.

## ⌨️ Keyboard Shortcuts

- **Undo**: `Ctrl + Z` / `Cmd + Z`
- **Redo**: `Ctrl + Shift + Z` or `Ctrl + Y`
- **Save Change**: `Ctrl + S`
- **Open Export Modal**: `Ctrl + Shift + S`

---

## 🏗️ Production Build

To create an optimized production build:

```bash
pnpm build
```

The output will be located in the `dist/` directory, ready to be served by any static web server.

## 🧪 Tech Stack

- **Framework**: React 19 (TypeScript)
- **Styling**: Tailwind CSS
- **Visualization**: OpenSeadragon
- **Geometry**: Turf.js & Polygon-clipping
- **Networking**: Axios
- **Build Tool**: Vite
