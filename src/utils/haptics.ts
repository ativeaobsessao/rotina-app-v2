export function triggerHapticFeedback(pattern: number | number[] = 50) {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      // Ignore errors if vibration is not supported or blocked
    }
  }
}
