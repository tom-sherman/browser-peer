const outConfig = {
  name: 'Peer'
}

export default {
  input: './src/peer.js',
  output: [
    Object.assign({}, outConfig, { // ES6
      file: './index.js',
      format: 'es'
    }),
    Object.assign({}, outConfig, { // IIFE
      file: './dist/browser-peer.js',
      format: 'iife'
    }),
    Object.assign({}, outConfig, { // CJS
      file: './dist/browser-peer.cjs.js',
      format: 'cjs'
    })
  ]
}
