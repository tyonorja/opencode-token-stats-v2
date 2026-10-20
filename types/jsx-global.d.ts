// Global JSX intrinsic elements for @opentui/solid (host-provided at runtime).
// Declared globally so TypeScript can type-check JSX in .tsx files.

declare global {
  namespace JSX {
    interface IntrinsicElements {
      box: any
      text: any
      span: any
      [key: string]: any
    }
  }
}

export {}
