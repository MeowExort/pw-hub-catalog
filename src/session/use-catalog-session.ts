import { useCallback, useEffect, useRef, useState } from 'react'
import type { Gender } from '../domain/model.ts'
import type { Calibration } from '../imaging/segmentation.ts'
import { Analyzer } from '../services/analyzer.ts'
import { ScreenCapture } from '../services/screen-capture.ts'
import { initialState, SessionController } from './controller.ts'

export function useCatalogSession() {
  const [state, setState] = useState(initialState)
  const controller = useRef<SessionController | null>(null)
  useEffect(() => {
    const instance = new SessionController({
      createEngine: () => new Analyzer(),
      createCapture: () => new ScreenCapture(),
      onChange: setState,
    })
    controller.current = instance
    return () => {
      controller.current = null
      instance.dispose()
    }
  }, [])
  return {
    state,
    start: useCallback(
      (gender: Gender, calibration: Calibration) =>
        controller.current?.startCapture(gender, calibration),
      [],
    ),
    analyzeFile: useCallback(
      (file: File, gender: Gender, calibration: Calibration) =>
        controller.current?.analyzeFile(file, gender, calibration),
      [],
    ),
    stop: useCallback(() => controller.current?.stop(), []),
  }
}
