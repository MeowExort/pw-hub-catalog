import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/domain/**/*.ts',
        'src/imaging/preprocessing.ts',
        'src/imaging/dimensions.ts',
        'src/imaging/segmentation.ts',
        'src/services/abort.ts',
        'src/services/ocr-pool.ts',
        'src/services/screen-capture.ts',
        'src/services/image-processor.ts',
        'src/session/**/*.ts',
        'src/ui/blob-image.tsx',
      ],
      reporter: ['text', 'html'],
      thresholds: { statements: 85, branches: 75, functions: 85, lines: 85 },
    },
  },
})
