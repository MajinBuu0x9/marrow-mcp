# Source Code — Reconstructed

**Status:** ✅ Source code reconstructed from compiled output (v2.8.0)

**What's included:**
- ✅ `src/types.ts` — All TypeScript type definitions
- ✅ `src/index.ts` — API functions (marrowThink, marrowCommit, marrowOrient, etc.)
- ✅ `src/cli.ts` — MCP stdio server implementation
- ✅ `tsconfig.json` — TypeScript build configuration
- ✅ Compiled `dist/` folder (working code from npm v2.8.0)
- ✅ Updated README with v2.8.0 features

**Reconstruction method:**
Source was reconstructed from the compiled JavaScript and TypeScript declarations (`.d.ts` files) that were published to npm. The reconstructed source compiles to match the existing dist/ output.

**Building:**
```bash
npm install
npm run build
```

**Running:**
```bash
export MARROW_API_KEY="your_key"
npx @getmarrow/mcp
```

**Publishing:**
```bash
npm publish --access public
```
