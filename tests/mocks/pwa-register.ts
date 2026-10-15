/** Resolution seam only: each UI suite must explicitly mock the virtual module. */
export function useRegisterSW(): never {
  throw new Error('Mock useRegisterSW explicitly; production PWA is verified in browser tests.')
}
