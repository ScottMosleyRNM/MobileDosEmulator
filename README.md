# Mobile DOS Emulator

Best-shot clean project bundle with:

- React + Vite + TypeScript + Tailwind
- Mobile-focused DOS UI
- Native ZIP central-directory parser for launch detection
- js-dos runtime for mounting and launching ZIP games

## Run

```bash
npm install
npm run dev
```

## Notes

- ZIP analysis does not use JSZip.
- Runtime extraction still uses js-dos CDN.
- Snapshot actions are scaffolded but js-dos state save/load is still placeholder.
