# NeuroPolygraph 2077

A cyberpunk-styled holographic lie detector powered by Google Gemini Multimodal Live API. Analyzes micro-expressions and vocal stress patterns in real-time.

![Cyberpunk Lie Detector](https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6)

## Features

- Real-time video and audio analysis via Gemini Multimodal Live API
- Micro-expression detection and vocal stress analysis
- Simulated biometric displays (heart rate, stress level, pupil dilation)
- Deception probability visualization with historical trends
- Cyberpunk holographic UI design
- Mobile-responsive layout

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **AI**: Google Gemini Multimodal Live API
- **Charts**: Recharts
- **Icons**: Lucide React

## Getting Started

### Prerequisites

- Node.js 18+
- Gemini API Key ([Get one here](https://makersuite.google.com/app/apikey))

### Installation

```bash
# Clone the repository
git clone https://github.com/fangchen/lierteller.git
cd lierteller

# Install dependencies
npm install

# Configure API key
# Edit .env.local and set your GEMINI_API_KEY

# Start development server
npm run dev
```

### Environment Variables

Create a `.env.local` file:

```
GEMINI_API_KEY=your_api_key_here
```

## Usage

1. Click "INITIALIZE SYSTEM" to start
2. Allow camera and microphone access
3. Speak naturally - the AI will analyze your expressions and voice
4. View real-time deception probability and biometric simulations

## License

MIT
