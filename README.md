# JARVIS Desktop GUI

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### AI backend (Groq)

The "Ask Jarvis..." input is wired to Groq. The API key is used only in the
Electron main process and is never bundled into the renderer.

```bash
$ cp .env.example .env
# then edit .env and set GROQ_API_KEY=your-key-from-console.groq.com
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
